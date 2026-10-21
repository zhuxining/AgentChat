import { createRegistry } from "@earendil-works/pi-durable";

import { botMemoryExtension } from "./extensions/bot-memory.js";
import { codingToolsExtension } from "./extensions/coding.js";
import { workGoalExtension } from "./extensions/work-goal.js";

export function createRunnerRegistry() {
  const registry = createRegistry();
  registry.install(codingToolsExtension);
  registry.install(botMemoryExtension);
  registry.install(workGoalExtension);
  return registry;
}
