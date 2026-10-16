import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { ConfigurationFailure } from "./schema.js";

export const MAX_CONFIG_BYTES = 256 * 1024;
export function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}
export function isMissing(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}
export function diagnostic(error: unknown): string {
  if (error instanceof ConfigurationFailure) return error.message;
  if (isMissing(error)) return "配置文件缺失";
  return "配置文件无法访问或写入";
}
/** Config files must stay under the chosen root and cannot traverse any symlink. */
export class ConfigurationFiles {
  constructor(readonly root: string) {}

  path(path: string): string {
    if (
      !path ||
      isAbsolute(path) ||
      path.includes("\0") ||
      path.includes("\\") ||
      path.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new ConfigurationFailure("配置路径无效");
    }
    const full = resolve(this.root, path);
    const rel = relative(this.root, full);
    if (rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel))
      throw new ConfigurationFailure("配置路径越界");
    return full;
  }

  async check(path: string, allowMissing = false): Promise<string> {
    const full = this.path(path);
    const parts = path.split("/");
    for (let index = 0; index < parts.length; index++) {
      const current = resolve(this.root, ...parts.slice(0, index + 1));
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink()) throw new ConfigurationFailure("配置路径不能包含符号链接");
        if (index < parts.length - 1 && !stat.isDirectory())
          throw new ConfigurationFailure("配置父路径不是目录");
      } catch (error) {
        if (allowMissing && isMissing(error)) break;
        throw error;
      }
    }
    return full;
  }

  async ensureDirectory(path: string): Promise<void> {
    this.path(path);
    for (const [index] of path.split("/").entries()) {
      const partial = path
        .split("/")
        .slice(0, index + 1)
        .join("/");
      await this.check(partial, true);
      await mkdir(this.path(partial), { mode: 0o700 }).catch((error: unknown) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST"))
          throw error;
      });
      const stat = await lstat(this.path(partial));
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new ConfigurationFailure("配置目录无效");
    }
  }

  async read(path: string): Promise<{ content: string; version: string }> {
    const full = await this.check(path);
    const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES)
        throw new ConfigurationFailure("配置必须是大小受限的普通文件");
      // A bounded read also covers a file growing after stat().
      const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, null);
        if (bytesRead === 0) break;
        length += bytesRead;
      }
      if (length > MAX_CONFIG_BYTES) throw new ConfigurationFailure("配置文件过大");
      return {
        content: bytes.subarray(0, length).toString("utf8"),
        version: createHash("sha256").update(bytes.subarray(0, length)).digest("hex"),
      };
    } finally {
      await file.close();
    }
  }

  async listBots(): Promise<string[]> {
    await this.check("bots");
    return (await readdir(this.path("bots"), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.check(path);
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  async write(path: string, content: string, checkVersion: () => Promise<void>): Promise<void> {
    if (Buffer.byteLength(content) > MAX_CONFIG_BYTES)
      throw new ConfigurationFailure("配置文件过大");
    const full = await this.check(path, true);
    const parent = dirname(full);
    const parentStat = await lstat(parent);
    if ((parentStat.mode & 0o222) === 0) throw new ConfigurationFailure("配置目录只读");
    try {
      const stat = await lstat(full);
      if (!stat.isFile() || (stat.mode & 0o222) === 0)
        throw new ConfigurationFailure("配置文件只读或不是普通文件");
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const temporary = resolve(parent, `.config-${randomUUID()}.tmp`);
    try {
      const file = await open(temporary, "wx", 0o600);
      try {
        await file.writeFile(content, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      // Compare immediately before replacing. Independent editors cannot participate in our lock.
      await this.check(path, true);
      await checkVersion();
      await rename(temporary, full);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}
