import { describe, expect, test } from "bun:test";
import { ODT_MCP_TOOL_NAMES, toClaudeOdtToolAliases } from "@openducktor/contracts";
import { isOdtMutationToolName, normalizeOdtToolName, ODT_READ_TOOL_NAMES } from "./odt-tools";

describe("ODT tool metadata", () => {
  test("normalizes every canonical tool and its Claude aliases", () => {
    for (const toolName of ODT_MCP_TOOL_NAMES) {
      expect(normalizeOdtToolName(toolName, toClaudeOdtToolAliases)).toBe(toolName);
      for (const alias of toClaudeOdtToolAliases(toolName)) {
        expect(normalizeOdtToolName(alias, toClaudeOdtToolAliases)).toBe(toolName);
      }
    }
  });

  test("keeps the complete read-only catalog explicit", () => {
    expect(ODT_READ_TOOL_NAMES).toEqual([
      "odt_get_workspaces",
      "odt_search_tasks",
      "odt_read_task",
      "odt_read_task_assets",
      "odt_read_task_documents",
    ]);
    expect(isOdtMutationToolName("odt_create_task")).toBe(true);
    expect(isOdtMutationToolName("odt_search_tasks")).toBe(false);
  });

  test("does not classify unknown tool names as ODT mutations", () => {
    expect(normalizeOdtToolName("unknown_tool")).toBeNull();
    expect(isOdtMutationToolName("unknown_tool")).toBe(false);
  });
});
