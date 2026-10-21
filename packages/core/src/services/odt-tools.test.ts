import { describe, expect, test } from "bun:test";
import {
  ODT_BROWSER_READ_TOOL_NAMES,
  ODT_BROWSER_TOOL_NAMES,
  ODT_MCP_TOOL_NAMES,
  toClaudeOdtToolAliases,
} from "@openducktor/contracts";
import { classifyOdtToolMutation, normalizeOdtToolName, ODT_READ_TOOL_NAMES } from "./odt-tools";

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
    expect(classifyOdtToolMutation("odt_create_task")).toBe("mutating");
    expect(classifyOdtToolMutation("odt_search_tasks")).toBe("read_only");
  });

  test("classifies page reads as read-only and leaves page actions unclassified", () => {
    const reads = new Set<string>(ODT_BROWSER_READ_TOOL_NAMES);
    for (const toolName of ODT_BROWSER_TOOL_NAMES) {
      const expected = reads.has(toolName) ? "read_only" : "unknown";
      expect(classifyOdtToolMutation(toolName)).toBe(expected);
      for (const alias of toClaudeOdtToolAliases(toolName)) {
        expect(classifyOdtToolMutation(alias, toClaudeOdtToolAliases)).toBe(expected);
      }
    }
  });

  test("does not classify unknown tool names as ODT tools", () => {
    expect(normalizeOdtToolName("unknown_tool")).toBeNull();
    expect(classifyOdtToolMutation("unknown_tool")).toBeNull();
  });
});
