export const BOT_MEMORY_MAX_CHARACTERS = 2_000;

export type BotMemory = {
  botId: string;
  content: string;
  revision: number;
  source: "user" | null;
  updatedAt: number | null;
};

export type SaveBotMemoryResult = {
  memory: BotMemory;
  redacted: boolean;
};
