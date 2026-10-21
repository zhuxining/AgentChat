import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  createRegistry,
  Harness,
  MemoryStorage,
  type Conversation,
  type EntryRecord,
} from "@earendil-works/pi-durable";
import { describe, expect, it, vi } from "vite-plus/test";

import { attachmentInputEntryKind } from "../src/harness/attachments.js";
import { projectMessages, readProjectedMessages } from "../src/harness/messages.js";

const context = BACKGROUND_CONTEXT;
const entry = (content: string) => ({
  kind: "test.message",
  model: [{ role: "user" as const, content, timestamp: 1 }],
});
async function reference(conversation: Conversation) {
  const state = await conversation.viewState(context);
  try {
    return projectMessages(state.value.entries);
  } finally {
    state.dispose();
  }
}

describe("bounded message projection", () => {
  it("shows attachment labels while hiding new and legacy attachment bodies", async () => {
    const storage = new MemoryStorage();
    const harness = await Harness.open(
      storage,
      { models: createModels(), registry: createRegistry() },
      context,
    );
    try {
      const conversation = await harness.createConversation(
        { ownership: { kind: "ownerless" } },
        context,
      );
      await harness.commit(async (tx) => {
        await tx.appendEntry(conversation.id, {
          kind: attachmentInputEntryKind,
          data: {
            textLength: "请检查".length,
            attachments: [{ name: "secret.md", type: "text" }],
          },
          model: [
            {
              role: "user",
              content: "请检查\n\n[附件文本：secret.md]\n私密正文\n[/附件文本]",
              timestamp: 1,
            },
          ],
        });
        await tx.appendEntry(conversation.id, {
          kind: "pi.user",
          model: [
            {
              role: "user",
              content: "旧版消息\n\n[附件文本：legacy.md]\n旧版私密正文\n[/附件文本]",
              timestamp: 2,
            },
          ],
        });
      }, context);

      const projected = await reference(conversation);

      expect(projected.messages.map(({ text }) => text)).toEqual([
        "请检查\n\n[文本附件：secret.md]",
        "旧版消息\n[附件正文已隐藏]",
      ]);
      expect(JSON.stringify(projected)).not.toContain("私密正文");
      expect(JSON.stringify(projected)).not.toContain("旧版私密正文");
    } finally {
      await harness.close(context);
    }
  });

  it("matches the full view while reading at most the tail and 51 entries for a long transcript", async () => {
    const storage = new MemoryStorage();
    const harness = await Harness.open(
      storage,
      { models: createModels(), registry: createRegistry() },
      context,
    );
    try {
      const conversation = await harness.createConversation(
        { ownership: { kind: "ownerless" } },
        context,
      );
      await harness.commit(async (tx) => {
        for (let index = 0; index < 1000; index++)
          await tx.appendEntry(conversation.id, entry(`Message ${index}`));
      }, context);
      const expected = await reference(conversation);
      const scans = vi.spyOn(storage, "scanEntries");
      const actual = await readProjectedMessages(storage, conversation.id);
      expect(actual).toEqual(expected);
      const pages = await Promise.all(scans.mock.results.map((result) => result.value));
      expect(pages.reduce((count, page) => count + page.items.length, 0)).toBeLessThanOrEqual(52);
      expect(actual.hasMoreMessages).toBe(true);
      scans.mockRestore();
    } finally {
      await harness.close(context);
    }
  });

  it("preserves empty, exactly-50, head/reset and fork semantics of the public full view", async () => {
    const storage = new MemoryStorage();
    const harness = await Harness.open(
      storage,
      { models: createModels(), registry: createRegistry() },
      context,
    );
    try {
      const conversation = await harness.createConversation(
        { ownership: { kind: "ownerless" } },
        context,
      );
      expect(await readProjectedMessages(storage, conversation.id)).toEqual(
        await reference(conversation),
      );
      const original: EntryRecord[] = [];
      await harness.commit(async (tx) => {
        for (let index = 0; index < 50; index++)
          original.push(await tx.appendEntry(conversation.id, entry(`Old ${index}`)));
      }, context);
      expect(await readProjectedMessages(storage, conversation.id)).toEqual(
        await reference(conversation),
      );
      await harness.commit(async (tx) => {
        await tx.appendEntry(conversation.id, { ...entry("Reset"), head: "self" });
        for (let index = 0; index < 5; index++)
          await tx.appendEntry(conversation.id, entry(`New ${index}`));
      }, context);
      const reset = await readProjectedMessages(storage, conversation.id);
      expect(reset).toEqual(await reference(conversation));
      expect(reset.hasMoreMessages).toBe(false);
      expect(reset.messages.map((message) => message.text)).toEqual([
        "Reset",
        "New 0",
        "New 1",
        "New 2",
        "New 3",
        "New 4",
      ]);
      // A later head can retain old non-head entries while excluding the earlier reset marker.
      await harness.commit(async (tx) => {
        await tx.appendEntry(conversation.id, { ...entry("Compacted"), head: original[10]!.id });
      }, context);
      expect(await readProjectedMessages(storage, conversation.id)).toEqual(
        await reference(conversation),
      );
      const fork = await conversation.fork(
        original[25]!.id,
        { ownership: { kind: "ownerless" } },
        context,
      );
      await harness.commit(async (tx) => {
        await tx.appendEntry(fork.id, entry("Fork only"));
      }, context);
      expect(await readProjectedMessages(storage, fork.id)).toEqual(await reference(fork));
      expect((await readProjectedMessages(storage, fork.id)).messages.at(-1)?.text).toBe(
        "Fork only",
      );
    } finally {
      await harness.close(context);
    }
  });
});
