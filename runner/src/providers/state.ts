import { randomUUID } from "node:crypto";

import type { ModelsStore, ModelsStoreEntry } from "@earendil-works/pi-ai";

import type { ProviderInstance } from "../../../contracts/providers.js";
import { ConfigurationFiles, digest } from "../config/files.js";
import { parseChatModel } from "./schema.js";

type StoredCatalog = { signature: string; entry: ModelsStoreEntry };
/** Non-secret metadata: auth revisions and explicit remote model catalog snapshots. */
export class ProviderState {
  private revision = "0";
  private catalogs: Record<string, StoredCatalog> = {};
  private queue: Promise<void> = Promise.resolve();
  private constructor(private readonly files: ConfigurationFiles) {}
  static async open(dataDir: string): Promise<ProviderState> {
    const state = new ProviderState(new ConfigurationFiles(dataDir));
    try {
      const raw: unknown = JSON.parse((await state.files.read("provider-state.json")).content);
      if (
        !raw ||
        typeof raw !== "object" ||
        !("revision" in raw) ||
        typeof raw.revision !== "string" ||
        !("catalogs" in raw) ||
        !raw.catalogs ||
        typeof raw.catalogs !== "object" ||
        Array.isArray(raw.catalogs)
      )
        throw new Error("供应商状态元数据无效");
      state.revision = raw.revision;
      for (const [id, value] of Object.entries(raw.catalogs)) {
        if (
          !value ||
          typeof value !== "object" ||
          !("signature" in value) ||
          typeof value.signature !== "string" ||
          !("entry" in value) ||
          !value.entry ||
          typeof value.entry !== "object" ||
          !("models" in value.entry) ||
          !Array.isArray(value.entry.models)
        )
          throw new Error("供应商目录缓存无效");
        state.catalogs[id] = {
          signature: value.signature,
          entry: { models: value.entry.models.map(parseChatModel) },
        };
      }
    } catch {
      // This file is a non-authoritative cache. Corrupt or unreadable content is
      // discarded here and rewritten on the next credential/catalog change.
    }
    return state;
  }
  get credentialRevision() {
    return this.revision;
  }
  private signature(instance: ProviderInstance) {
    return digest(
      JSON.stringify([instance.type, instance.baseUrl, instance.auth, instance.parameters]),
    );
  }
  get(instance: ProviderInstance): ModelsStoreEntry | undefined {
    const item = this.catalogs[instance.id];
    return item?.signature === this.signature(instance) ? structuredClone(item.entry) : undefined;
  }
  private mutate(action: () => void): Promise<void> {
    const result = this.queue.then(async () => {
      action();
      await this.files.write(
        "provider-state.json",
        JSON.stringify({ revision: this.revision, catalogs: this.catalogs }),
        async () => undefined,
      );
    });
    this.queue = result.catch(() => undefined);
    return result;
  }
  touch(): Promise<void> {
    return this.mutate(() => {
      this.revision = randomUUID();
    });
  }
  store(instances: ProviderInstance[]): ModelsStore {
    const find = (id: string) => {
      const item = instances.find((instance) => instance.id === id);
      if (!item) throw new Error("供应商目录实例不存在");
      return item;
    };
    return {
      read: async (id) => this.get(find(id)),
      write: async (id, entry) => {
        const item = find(id);
        const models = entry.models
          .filter((model) => !model.type || model.type === "chat")
          .map((model) => parseChatModel(JSON.parse(JSON.stringify(model))));
        await this.mutate(() => {
          this.revision = randomUUID();
          this.catalogs[id] = { signature: this.signature(item), entry: { ...entry, models } };
        });
      },
      delete: async (id) => {
        await this.mutate(() => {
          delete this.catalogs[id];
        });
      },
    };
  }
}
