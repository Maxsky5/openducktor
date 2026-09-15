import { describe, expect, test } from "bun:test";
import { agentToolNameValues, ODT_TOOL_SCHEMAS } from "@openducktor/contracts";
import { ODT_TOOL_ARG_SPEC } from "./odt-tool-arg-spec";

const parseArgNames = (spec: string): string[] => {
  const names: string[] = [];
  for (const match of spec.matchAll(/"([^"]+)"\??:/g)) {
    const name = match[1];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
};

describe("ODT_TOOL_ARG_SPEC", () => {
  test("covers every workflow tool in catalog order", () => {
    expect(Object.keys(ODT_TOOL_ARG_SPEC)).toEqual([...agentToolNameValues]);
  });

  test.each([...agentToolNameValues])(
    "renders every schema argument for %s without workspaceId",
    (toolName) => {
      const argumentFields = ODT_TOOL_SCHEMAS[toolName].shape;
      const schemaArgs = Object.keys(argumentFields).filter((name) => name !== "workspaceId");

      expect(parseArgNames(ODT_TOOL_ARG_SPEC[toolName])).toEqual(schemaArgs);

      for (const [name, field] of Object.entries(argumentFields)) {
        if (name === "workspaceId") {
          continue;
        }
        const optionalMarker = field.safeParse(undefined).success ? "?" : "";
        expect(ODT_TOOL_ARG_SPEC[toolName]).toContain(`"${name}"${optionalMarker}:`);
      }
    },
  );

  test("renders required, optional, enum, array, and literal argument types", () => {
    expect(ODT_TOOL_ARG_SPEC.odt_create_task).toBe(
      'odt_create_task({"title": string, "issueType": "task"|"feature"|"bug", "priority": number, "description"?: string, "labels"?: string[], "aiReviewEnabled"?: boolean})',
    );
    expect(ODT_TOOL_ARG_SPEC.odt_search_tasks).toBe(
      'odt_search_tasks({"priority"?: number, "issueType"?: "task"|"feature"|"bug"|"epic", "status"?: "open"|"spec_ready"|"ready_for_dev"|"in_progress"|"blocked"|"ai_review"|"human_review", "title"?: string, "tags"?: string[], "limit"?: number})',
    );
    expect(ODT_TOOL_ARG_SPEC.odt_read_task).toBe('odt_read_task({"taskId": string})');
    expect(ODT_TOOL_ARG_SPEC.odt_read_task_assets).toBe(
      'odt_read_task_assets({"taskId": string, "assetIds": string[]})',
    );
    expect(ODT_TOOL_ARG_SPEC.odt_set_pull_request).toBe(
      'odt_set_pull_request({"taskId": string, "providerId": "github", "number": number})',
    );
  });
});
