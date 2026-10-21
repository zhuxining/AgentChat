import { chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { attachmentInput } from "../src/harness/attachments.js";

const directories: string[] = [];
const staged = (dataDir: string) => join(dataDir, "attachments", "staged");

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map(async (path) => {
      await chmod(path, 0o700).catch(() => undefined);
      await rm(path, { recursive: true, force: true });
    }),
  );
});

async function fixture() {
  const dataDir = await realpath(await mkdtemp(join(tmpdir(), "agentchat-attachments-")));
  directories.push(dataDir);
  await mkdir(staged(dataDir), { recursive: true });
  return dataDir;
}

async function put(dataDir: string, id: string, bytes: Uint8Array) {
  await writeFile(join(staged(dataDir), id), bytes);
}

describe("staged attachment input", () => {
  it("adds UTF-8 text to the prompt and stores only its display metadata", async () => {
    const dataDir = await fixture();
    const id = "11111111-1111-4111-8111-111111111111";
    await put(dataDir, id, Buffer.from("const answer = 42;\n", "utf8"));

    const prepared = await attachmentInput(dataDir, "请检查", [{ id, name: "answer.ts" }]);

    expect(prepared.content).toEqual([
      {
        type: "text",
        text: "请检查\n\n[附件文本：answer\\.ts]\nconst answer = 42;\n\n[/附件文本]",
      },
    ]);
    expect(prepared.entry).toEqual({
      kind: "agentchat.input",
      data: { textLength: 3, attachments: [{ name: "answer.ts", type: "text" }] },
    });
  });

  it("checks image signatures and converts valid image bytes to model content", async () => {
    const dataDir = await fixture();
    const id = "22222222-2222-4222-8222-222222222222";
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2]);
    await put(dataDir, id, png);

    const prepared = await attachmentInput(dataDir, "描述图片", [{ id, name: "picture.png" }]);

    expect(prepared.content).toEqual([
      { type: "text", text: "描述图片\n\n[图片附件：picture\\.png]" },
      { type: "image", data: png.toString("base64"), mimeType: "image/png" },
    ]);
    expect(prepared.entry?.data).toEqual({
      textLength: 4,
      attachments: [{ name: "picture.png", type: "image" }],
    });
  });

  it("rejects duplicate or malformed references and unsupported names", async () => {
    const dataDir = await fixture();
    const id = "33333333-3333-4333-8333-333333333333";

    await expect(
      attachmentInput(dataDir, "", [
        { id, name: "one.txt" },
        { id, name: "two.txt" },
      ]),
    ).rejects.toThrow("附件引用无效或超过数量限制");
    await expect(
      attachmentInput(dataDir, "", [{ id: "../outside", name: "one.txt" }]),
    ).rejects.toThrow("附件引用无效");
    await expect(attachmentInput(dataDir, "", [{ id, name: "../outside.txt" }])).rejects.toThrow(
      "附件文件名无效",
    );
    await expect(attachmentInput(dataDir, "", [{ id, name: "archive.zip" }])).rejects.toThrow(
      "不支持的附件格式",
    );
    await expect(
      attachmentInput(dataDir, "", [
        { id, name: "one.txt" },
        { id: "44444444-4444-4444-8444-444444444444", name: "two.txt" },
        { id: "55555555-5555-4555-8555-555555555555", name: "three.txt" },
        { id: "66666666-6666-4666-8666-666666666666", name: "four.txt" },
      ]),
    ).rejects.toThrow("附件引用无效或超过数量限制");
  });

  it("rejects invalid UTF-8, mismatched image signatures, and oversized files", async () => {
    const dataDir = await fixture();
    const invalidTextId = "77777777-7777-4777-8777-777777777777";
    const invalidImageId = "88888888-8888-4888-8888-888888888888";
    const oversizedId = "99999999-9999-4999-8999-999999999999";
    await put(dataDir, invalidTextId, Buffer.from([0xc3, 0x28]));
    await put(dataDir, invalidImageId, Buffer.from("not a PNG"));
    await put(dataDir, oversizedId, Buffer.alloc(4 * 1024 * 1024 + 1, 65));

    await expect(
      attachmentInput(dataDir, "", [{ id: invalidTextId, name: "invalid.txt" }]),
    ).rejects.toThrow(/encoded data|encoding/i);
    await expect(
      attachmentInput(dataDir, "", [{ id: invalidImageId, name: "invalid.png" }]),
    ).rejects.toThrow("图片扩展名与文件内容不匹配");
    await expect(
      attachmentInput(dataDir, "", [{ id: oversizedId, name: "large.txt" }]),
    ).rejects.toThrow("附件超过大小限制");
  });

  it("enforces the combined size limit and reports missing staged files", async () => {
    const dataDir = await fixture();
    const references = [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "one.txt" },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "two.txt" },
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "three.txt" },
    ];
    for (const { id } of references) await put(dataDir, id, Buffer.alloc(4 * 1024 * 1024, 65));

    await expect(attachmentInput(dataDir, "", references)).rejects.toThrow("附件总大小超过 8 MiB");
    await expect(
      attachmentInput(dataDir, "", [
        { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "missing.md" },
      ]),
    ).rejects.toThrow("附件已失效，请重新选择");
  });

  it("rejects symlinked attachment directories and staged files", async () => {
    const dataDir = await fixture();
    const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const outside = join(dataDir, "outside.txt");
    await writeFile(outside, "outside");
    await symlink(outside, join(staged(dataDir), id));
    await expect(attachmentInput(dataDir, "", [{ id, name: "linked.txt" }])).rejects.toThrow(
      "附件文件边界无效",
    );

    const secondRoot = await realpath(await mkdtemp(join(tmpdir(), "agentchat-attachments-link-")));
    directories.push(secondRoot);
    const linkDataDir = join(secondRoot, "data");
    const targetAttachments = join(secondRoot, "target-attachments");
    await mkdir(join(targetAttachments, "staged"), { recursive: true });
    await mkdir(linkDataDir);
    await symlink(targetAttachments, join(linkDataDir, "attachments"));
    await expect(
      attachmentInput(linkDataDir, "", [
        { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "file.txt" },
      ]),
    ).rejects.toThrow("附件暂存目录边界无效");
  });
});
