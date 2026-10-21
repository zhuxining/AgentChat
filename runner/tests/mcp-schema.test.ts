import { Check } from "typebox/value";
import { describe, expect, it } from "vite-plus/test";

import { jsonSchemaToTypeBox } from "../src/harness/mcp.js";

function inputSchema(pattern: string) {
  return jsonSchemaToTypeBox({
    type: "object",
    properties: { value: { type: "string", pattern } },
    required: ["value"],
  });
}

describe("MCP input string patterns", () => {
  it("accepts anchored patterns with one bounded repetition and enforces them", () => {
    const schema = jsonSchemaToTypeBox({
      type: "object",
      properties: {
        slug: { type: "string", pattern: "^[a-z]{1,8}$" },
      },
      required: ["slug"],
    });

    expect(Check(schema, { slug: "agent" })).toBe(true);
    expect(Check(schema, { slug: "Agent" })).toBe(false);
    expect(Check(schema, { slug: "tool-name" })).toBe(false);
  });

  it("accepts a single anchored repetition without a numeric bound", () => {
    const schema = inputSchema("^[a-z]+$");
    expect(Check(schema, { value: "agentchat" })).toBe(true);
  });

  it.each([
    "^(a+)+$", // groups and nested repetition
    "^(cat|dog)$", // alternation
    "^(a)\\1$", // backreference
    "^[a-z]+[0-9]+$", // multiple repetitions
    "[a-z]+", // unanchored repetition
    "^[a-z]{1,70000}$", // repetition beyond the input limit
    "^[a-z]{4,2}$", // invalid numeric range
  ])("rejects unsupported or unsafe pattern %s", (pattern) => {
    expect(() => inputSchema(pattern)).toThrow("unsupported MCP tool schema");
  });
});
