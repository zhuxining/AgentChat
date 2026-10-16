import { defineExtension } from "@earendil-works/pi-durable";
import {
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
} from "@earendil-works/pi-durable/tools";

export const codingToolsExtension = defineExtension({
  name: "coding-tools",
  tools: [createBashTool(), createEditTool(), createReadTool(), createWriteTool()],
});
