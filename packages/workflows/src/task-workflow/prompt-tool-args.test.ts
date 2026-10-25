import { describe, expect, test } from "bun:test";
import { agentToolNameValues, ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { builtinWorkflow } from "../builtin/definition";
import { formatOdtToolArgs as formatArgs } from "./prompt-tool-args";

const formatOdtToolArgs = (toolName: Parameters<typeof formatArgs>[1]) =>
  formatArgs(builtinWorkflow.definition, toolName);

/** Reads the top-level argument names. Nested object members are not arguments. */
const parseArgNames = (toolArgs: string): string[] => {
  const names: string[] = [];
  for (const match of toolArgs.matchAll(/"([^"]+)"\??:/g)) {
    const name = match[1];
    const prefix = toolArgs.slice(0, match.index);
    const depth = prefix.split("{").length - prefix.split("}").length;
    if (name !== undefined && depth === 1) {
      names.push(name);
    }
  }
  return names;
};

describe("formatOdtToolArgs", () => {
  test.each([...agentToolNameValues])(
    "formats every schema argument for %s without workspaceId",
    (toolName) => {
      const toolArgs = formatOdtToolArgs(toolName);
      const toolSchema = ODT_TOOL_SCHEMAS[toolName];
      const schemaArgs = Object.entries(toolSchema.shape).filter(
        ([name]) => name !== "workspaceId",
      );

      expect(parseArgNames(toolArgs)).toEqual(schemaArgs.map(([name]) => name));

      for (const [name, field] of schemaArgs) {
        const optionalMarker = field.safeParse(undefined).success ? "?" : "";
        expect(toolArgs).toContain(`"${name}"${optionalMarker}:`);
      }
    },
  );

  test("formats required, optional, enum, array, and literal argument types", () => {
    expect(formatOdtToolArgs("odt_create_task")).toBe(
      'odt_create_task({"title": string, "issueType": "task"|"feature"|"bug", "priority": number, "description"?: string, "labels"?: string[]})',
    );
    expect(formatOdtToolArgs("odt_search_tasks")).toBe(
      'odt_search_tasks({"priority"?: number, "issueType"?: "task"|"feature"|"bug", "status"?: "open"|"spec_ready"|"ready_for_dev"|"in_progress"|"blocked"|"ai_review"|"human_review", "title"?: string, "tags"?: string[], "limit"?: number})',
    );
    expect(formatOdtToolArgs("odt_read_task")).toBe('odt_read_task({"taskId": string})');
    expect(formatOdtToolArgs("odt_read_task_assets")).toBe(
      'odt_read_task_assets({"taskId": string, "assetIds": string[]})',
    );
    expect(formatOdtToolArgs("odt_set_pull_request")).toBe(
      'odt_set_pull_request({"taskId": string, "number": number})',
    );
  });

  test("formats object members of a union argument", () => {
    expect(formatOdtToolArgs("odt_browser_wait")).toBe(
      'odt_browser_wait({"tabId": string, "text"?: string, "ref"?: string, "url"?: string, "load"?: "load"|"domcontentloaded"|"networkidle", "timeoutMs"?: number})',
    );
    expect(formatOdtToolArgs("odt_browser_list")).toBe("odt_browser_list({})");
  });
});
