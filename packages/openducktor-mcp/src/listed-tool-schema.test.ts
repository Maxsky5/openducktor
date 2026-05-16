import { describe, expect, test } from "bun:test";
import { ODT_TOOL_SCHEMAS } from "./lib";
import { getListedToolInputSchema } from "./listed-tool-schema";

const propertiesOf = (jsonSchema: Record<string, unknown>): Record<string, unknown> => {
  return jsonSchema.properties as Record<string, unknown>;
};

describe("listed MCP tool input schema", () => {
  test("uses the full contract schema for tool execution", () => {
    expect(ODT_TOOL_SCHEMAS.odt_read_task.shape).toHaveProperty("workspaceId");
  });

  test("hides workspaceId from listed tools when the MCP server is already workspace-scoped", () => {
    const properties = propertiesOf(
      getListedToolInputSchema("odt_read_task", { hideWorkspaceId: true }),
    );

    expect(properties).toHaveProperty("taskId");
    expect(properties).not.toHaveProperty("workspaceId");
  });

  test("keeps workspaceId in listed tools for external MCP clients", () => {
    const properties = propertiesOf(
      getListedToolInputSchema("odt_read_task", { hideWorkspaceId: false }),
    );

    expect(properties).toHaveProperty("workspaceId");
  });
});
