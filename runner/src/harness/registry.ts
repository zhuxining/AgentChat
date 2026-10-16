import { createRegistry } from "@earendil-works/pi-durable";

import { codingToolsExtension } from "./extensions/coding.js";
import { workGoalExtension } from "./extensions/work-goal.js";

export function createRunnerRegistry() {
  const registry = createRegistry();
  registry.install(codingToolsExtension);
  registry.install(workGoalExtension);
  return registry;
}
