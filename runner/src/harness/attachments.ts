import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { InputEntry, UserInput } from "@earendil-works/pi-durable";

export type AttachmentReference = { id: string; name: string };
export const attachmentInputEntryKind = "agentchat.input";

export type PreparedAttachmentInput = {
  content: UserInput;
  hasImages: boolean;
  entry?: InputEntry;
};

const maxAttachments = 3;
const maxTextBytes = 4 * 1024 * 1024;
const maxImageBytes = 3 * 1024 * 1024;
const maxTotalBytes = 8 * 1024 * 1024;
const textExtensions = new Set([
  "txt",
  "md",
  "markdown",
  "json",
  "csv",
  "tsv",
  "log",
  "yaml",
  "yml",
  "toml",
  "xml",
  "html",
  "css",
  "js",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rs",
  "go",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "sh",
  "sql",
  "ini",
  "conf",
]);
const imageMimeTypes: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};
const markdownSpecialCharacters = new Set("\\`*_{}[]()#+-.!|>");

export async function attachmentInput(
  dataDir: string,
  text: string,
  attachments: AttachmentReference[],
): Promise<PreparedAttachmentInput> {
  if (attachments.length === 0) return { content: text, hasImages: false };
  if (
    attachments.length > maxAttachments ||
    new Set(attachments.map(({ id }) => id)).size !== attachments.length
  ) {
    throw new Error("附件引用无效或超过数量限制");
  }

  const stageDirectory = await validatedStageDirectory(dataDir);
  const sections: string[] = [];
  const images: ImageContent[] = [];
  const attachmentHints: { name: string; type: "image" | "text" }[] = [];
  let totalBytes = 0;
  for (const attachment of attachments) {
    const kind = classifyName(attachment.name);
    const bytes = await readStagedFile(stageDirectory, attachment, kind.maxBytes);
    totalBytes += bytes.length;
    if (totalBytes > maxTotalBytes) throw new Error("附件总大小超过 8 MiB");
    validateContent(kind.extension, kind.imageMime, bytes);
    attachmentHints.push({ name: attachment.name, type: kind.imageMime ? "image" : "text" });
    if (kind.imageMime) {
      images.push({ type: "image", data: bytes.toString("base64"), mimeType: kind.imageMime });
      sections.push(`[图片附件：${escapeMarkdown(attachment.name)}]`);
    } else {
      const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      sections.push(`[附件文本：${escapeMarkdown(attachment.name)}]\n${content}\n[/附件文本]`);
    }
  }

  const prompt = [text.trim(), ...sections].filter(Boolean).join("\n\n");
  const content: (TextContent | ImageContent)[] = [{ type: "text", text: prompt }, ...images];
  return {
    content,
    hasImages: images.length > 0,
    entry: {
      kind: attachmentInputEntryKind,
      data: { textLength: text.trim().length, attachments: attachmentHints },
    },
  };
}

type AttachmentKind = { extension: string; imageMime: string | null; maxBytes: number };

function classifyName(name: string): AttachmentKind {
  if (!isSafeAttachmentName(name)) throw new Error("附件文件名无效");
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  if (textExtensions.has(extension)) return { extension, imageMime: null, maxBytes: maxTextBytes };
  const imageMime = imageMimeTypes[extension];
  if (imageMime) return { extension, imageMime, maxBytes: maxImageBytes };
  throw new Error("不支持的附件格式");
}

export function isSafeAttachmentName(name: string): boolean {
  return (
    name.length > 0 &&
    Array.from(name).length <= 255 &&
    basename(name) === name &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !hasUnsafeFilenameCharacters(name)
  );
}

async function validatedStageDirectory(dataDir: string): Promise<string> {
  const dataRoot = await realpath(dataDir).catch(() => {
    throw new Error("附件暂存目录不可用");
  });
  const attachmentRoot = join(dataRoot, "attachments");
  const stageDirectory = join(attachmentRoot, "staged");
  for (const directory of [attachmentRoot, stageDirectory]) {
    const metadata = await lstat(directory).catch(() => {
      throw new Error("附件暂存目录不可用");
    });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error("附件暂存目录边界无效");
    }
  }
  const canonicalDirectory = await realpath(stageDirectory).catch(() => {
    throw new Error("附件暂存目录不可用");
  });
  if (canonicalDirectory !== resolve(dataRoot, "attachments", "staged")) {
    throw new Error("附件暂存目录边界无效");
  }
  return canonicalDirectory;
}

async function readStagedFile(
  directory: string,
  attachment: AttachmentReference,
  maxBytes: number,
): Promise<Buffer> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(attachment.id)) {
    throw new Error("附件引用无效");
  }
  const path = join(directory, attachment.id);
  const metadata = await lstat(path).catch(() => {
    throw new Error("附件已失效，请重新选择");
  });
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error("附件文件边界无效");
  const canonicalPath = await realpath(path).catch(() => {
    throw new Error("附件已失效，请重新选择");
  });
  if (canonicalPath !== path) throw new Error("附件文件边界无效");

  const noFollow = process.platform === "win32" ? 0 : constants.O_NOFOLLOW;
  const handle = await open(path, constants.O_RDONLY | noFollow).catch(() => {
    throw new Error("附件已失效，请重新选择");
  });
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > maxBytes) throw new Error("附件超过大小限制");
    const chunks: Buffer[] = [];
    let length = 0;
    while (length <= maxBytes) {
      const buffer = Buffer.alloc(Math.min(64 * 1024, maxBytes + 1 - length));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      chunks.push(buffer.subarray(0, bytesRead));
      length += bytesRead;
    }
    if (length > maxBytes) throw new Error("附件超过大小限制");
    return Buffer.concat(chunks, length);
  } finally {
    await handle.close();
  }
}

function validateContent(extension: string, imageMime: string | null, bytes: Buffer) {
  if (!imageMime) {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return;
  }
  const valid =
    (extension === "png" &&
      bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
    ((extension === "jpg" || extension === "jpeg") &&
      bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
    (extension === "gif" &&
      ["GIF87a", "GIF89a"].some((signature) => bytes.subarray(0, 6).toString() === signature)) ||
    (extension === "webp" &&
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString() === "RIFF" &&
      bytes.subarray(8, 12).toString() === "WEBP");
  if (!valid) throw new Error("图片扩展名与文件内容不匹配");
}

function escapeMarkdown(value: string) {
  let escaped = "";
  for (const character of value) {
    escaped += markdownSpecialCharacters.has(character) ? `\\${character}` : character;
  }
  return escaped;
}

function hasUnsafeFilenameCharacters(value: string) {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (
      code <= 31 ||
      (code >= 127 && code <= 159) ||
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x2028 && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}
