import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type {
  Conversation,
  ConversationId,
  Cursor,
  EntryRecord,
  Storage,
} from "@earendil-works/pi-durable";

type Entries = Awaited<ReturnType<Conversation["viewState"]>>["value"]["entries"];
const maxProjectedMessages = 50;
const maxProjectedTextChars = 2_000;
type MessageProjection = {
  id: number;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  truncated: boolean;
};

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

export function projectMessages(entries: Entries) {
  const messages: MessageProjection[] = entries.slice(-maxProjectedMessages).map((entry) => {
    const model = entry.model?.[0] as { role?: string; content?: unknown } | undefined;
    // User entries use string content; assistant/tool entries may use structured blocks.
    const text =
      typeof model?.content === "string"
        ? model.content
        : Array.isArray(model?.content)
          ? model.content
              .map((part) => {
                if (!part || typeof part !== "object") return "";
                const item = part as { type?: string; text?: string; name?: string };
                if (item.type === "text") return item.text ?? "";
                if (item.type === "toolCall") return `调用工具：${item.name ?? "工具"}`;
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
    const limitedText = limitText(text);
    return { id: entry.id, role, text: limitedText.text, truncated: limitedText.truncated };
  });
  return { messages, hasMoreMessages: entries.length > maxProjectedMessages };
}

function limitText(value: string): { text: string; truncated: boolean } {
  const characters = Array.from(value);
  return {
    text: characters.slice(0, maxProjectedTextChars).join(""),
    truncated: characters.length > maxProjectedTextChars,
  };
}
