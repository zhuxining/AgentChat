import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  Conversation,
  ConversationId,
  Cursor,
  EntryId,
  EntryRecord,
  Storage,
} from "@earendil-works/pi-durable";

import { attachmentInputEntryKind, isSafeAttachmentName } from "./attachments.js";

type Entries = Awaited<ReturnType<Conversation["viewState"]>>["value"]["entries"];
const maxProjectedMessages = 50;
const maxProjectedTextChars = 2_000;
type MessageProjection = {
  id: number;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  truncated: boolean;
};
export type ChatHistoryMessage = {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  text: string;
};
export type ConversationHistoryScan = {
  tailId?: EntryId | null;
  headMarkerId?: EntryId | null;
  minEntryId?: EntryId | null;
  cursor?: Cursor;
};

const maxChatHistoryPageMessages = 50;

export async function readProjectedMessages(storage: Storage, conversationId: ConversationId) {
  const context = BACKGROUND_CONTEXT;
  const tail = (await storage.scanEntries({ conversationId }, 1, undefined, context)).items[0];
  if (!tail) return projectMessages([]);
  // Freeze the visible tail before locating its head. Entries within these bounds are immutable.
  const head = await storage.findLatestHeadMarker(conversationId, tail.id, context);
  const query = {
    conversationId,
    maxEntryId: tail.id,
    ...(head ? { minEntryId: head.head } : {}),
  };
  const entries: EntryRecord[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await storage.scanEntries(query, maxProjectedMessages + 1, cursor, context);
    for (const entry of page.items) {
      if (head && entry.head !== undefined) continue;
      entries.push(entry);
      if (entries.length > maxProjectedMessages) break;
    }
    cursor = page.next;
  } while (cursor !== undefined && entries.length <= maxProjectedMessages);
  entries.reverse();
  // The active view prepends the latest head and excludes earlier head markers.
  // Once 51 non-head entries are present, that prepended marker is outside the projection.
  if (head && entries.length <= maxProjectedMessages) entries.unshift(head);
  return projectMessages(entries);
}

// Chat uses a separate unbounded-text projection. Snapshot callers keep their small bounded view.
export async function readChatHistoryConversationPage(
  storage: Storage,
  conversationId: ConversationId,
  scan: ConversationHistoryScan,
  limit: number,
): Promise<{ messages: ChatHistoryMessage[]; scan: ConversationHistoryScan; done: boolean }> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxChatHistoryPageMessages) {
    throw new Error("历史分页大小无效");
  }
  let tailId = scan.tailId;
  let headMarkerId = scan.headMarkerId;
  let minEntryId = scan.minEntryId;
  let cursor = scan.cursor;
  if (tailId === undefined) {
    const tail = (await storage.scanEntries({ conversationId }, 1, undefined, BACKGROUND_CONTEXT))
      .items[0];
    if (!tail) return { messages: [], scan: { tailId: null }, done: true };
    tailId = tail.id;
    const headMarker = await storage.findLatestHeadMarker(conversationId, tail.id, BACKGROUND_CONTEXT);
    headMarkerId = headMarker?.id ?? null;
    minEntryId = headMarker?.head ?? null;
  }
  if (tailId === null) return { messages: [], scan: { tailId: null }, done: true };

  // A branch switch appends a new active head marker. Refuse to continue a cursor
  // whose frozen range no longer matches the Conversation's current active branch.
  if (headMarkerId !== undefined) {
    const activeHeadMarker = await storage.findLatestHeadMarker(conversationId, undefined, BACKGROUND_CONTEXT);
    if ((activeHeadMarker?.id ?? null) !== headMarkerId || (activeHeadMarker?.head ?? null) !== minEntryId) {
      throw new Error("历史游标无效");
    }
  }

  const messages: ChatHistoryMessage[] = [];
  let done = false;
  while (messages.length < limit) {
    const query = {
      conversationId,
      maxEntryId: tailId,
      ...(minEntryId === null || minEntryId === undefined ? {} : { minEntryId }),
    };
    const page = await storage.scanEntries(query, limit - messages.length, cursor, BACKGROUND_CONTEXT);
    for (const entry of page.items) {
      if (entry.head !== undefined) continue;
      const projected = projectMessage(entry, false);
      if ((projected.role !== "user" && projected.role !== "assistant") || !projected.text) continue;
      messages.push({
        id: entry.id,
        conversationId,
        role: projected.role,
        text: projected.text,
      });
    }
    cursor = page.next;
    if (page.next === undefined || page.items.length === 0) {
      done = true;
      break;
    }
  }
  return {
    messages,
    scan: { tailId, headMarkerId, minEntryId, ...(cursor ? { cursor } : {}) },
    done,
  };
}

export function projectMessages(entries: Entries) {
  const messages: MessageProjection[] = entries
    .slice(-maxProjectedMessages)
    .map((entry) => projectMessage(entry, true));
  return { messages, hasMoreMessages: entries.length > maxProjectedMessages };
}

function projectMessage(entry: Entries[number], bounded: boolean): MessageProjection {
  const model = entry.model?.[0] as { role?: string; content?: unknown } | undefined;
  // User entries use string content; assistant/tool entries may have structured blocks.
  const text =
    typeof model?.content === "string"
      ? model.content
      : Array.isArray(model?.content)
        ? model.content
            .map((part) => {
              if (!part || typeof part !== "object") return "";
              const item = part as { type?: string; text?: string };
              if (item.type === "text") return item.text ?? "";
              return "";
            })
            .filter(Boolean)
            .join("\n")
        : "";
  const role =
    model?.role === "user"
      ? "user"
      : model?.role === "assistant"
        ? "assistant"
        : model?.role === "system"
          ? "system"
          : "tool";
  const displayText =
    role === "user"
      ? (projectAttachmentInput(entry, text) ??
        (entry.kind === attachmentInputEntryKind
          ? "[附件消息已隐藏]"
          : redactLegacyAttachmentText(entry.kind, text)))
      : text;
  const limitedText = bounded ? limitText(displayText) : { text: displayText, truncated: false };
  return { id: entry.id, role, text: limitedText.text, truncated: limitedText.truncated };
}

function projectAttachmentInput(entry: Entries[number], content: string): string | undefined {
  if (entry.kind !== attachmentInputEntryKind || !isRecord(entry.data)) return undefined;
  const { textLength, attachments } = entry.data;
  if (
    typeof textLength !== "number" ||
    !Number.isSafeInteger(textLength) ||
    textLength < 0 ||
    textLength > content.length ||
    !Array.isArray(attachments)
  ) {
    return undefined;
  }
  const labels: string[] = [];
  for (const attachment of attachments) {
    if (!isRecord(attachment) || (attachment.type !== "image" && attachment.type !== "text")) {
      return undefined;
    }
    if (typeof attachment.name !== "string" || !isSafeAttachmentName(attachment.name)) {
      return undefined;
    }
    labels.push(
      attachment.type === "image"
        ? `[图片附件：${attachment.name}]`
        : `[文本附件：${attachment.name}]`,
    );
  }
  return [content.slice(0, textLength), ...labels].filter(Boolean).join("\n\n");
}

function redactLegacyAttachmentText(kind: string, value: string): string {
  if (kind !== "pi.user") return value;
  const marker = "[附件文本：";
  const start = value.indexOf(marker);
  if (start < 0) return value;
  return `${value.slice(0, start).trimEnd()}\n[附件正文已隐藏]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function limitText(value: string): { text: string; truncated: boolean } {
  const characters = Array.from(value);
  return {
    text: characters.slice(0, maxProjectedTextChars).join(""),
    truncated: characters.length > maxProjectedTextChars,
  };
}
