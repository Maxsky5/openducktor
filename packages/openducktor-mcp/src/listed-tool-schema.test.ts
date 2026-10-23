import { describe, expect, test } from "bun:test";
import { ODT_HOST_BRIDGE_RESPONSE_SCHEMAS } from "./lib";
import { getListedToolInputSchema, getListedToolOutputSchema } from "./listed-tool-schema";

type ListedToolSchema = ReturnType<typeof getListedToolInputSchema>;

const propertiesOf = (jsonSchema: ListedToolSchema): NonNullable<ListedToolSchema["properties"]> =>
  jsonSchema.properties ?? {};

const requiredOf = (jsonSchema: ListedToolSchema): string[] => jsonSchema.required ?? [];

describe("listed MCP tool input schema", () => {
  test("hides workspaceId from listed tools when the MCP server is already workspace-scoped", () => {
    const schema = getListedToolInputSchema("odt_read_task", { hideWorkspaceId: true });
    const properties = propertiesOf(schema);

    expect(properties).toHaveProperty("taskId");
    expect(properties).not.toHaveProperty("workspaceId");
    expect(requiredOf(schema)).not.toContain("workspaceId");
  });

  test("keeps workspaceId in listed tools for external MCP clients", () => {
    const properties = propertiesOf(
      getListedToolInputSchema("odt_read_task", { hideWorkspaceId: false }),
    );

    expect(properties).toHaveProperty("workspaceId");
  });

  test("lists the task asset batch fields while hiding the bound workspace", () => {
    const schema = getListedToolInputSchema("odt_read_task_assets", {
      hideWorkspaceId: true,
    });
    const properties = propertiesOf(schema);

    expect(properties).toHaveProperty("taskId");
    expect(properties).toHaveProperty("assetIds");
    expect(properties).not.toHaveProperty("workspaceId");
    expect(requiredOf(schema)).toEqual(expect.arrayContaining(["taskId", "assetIds"]));
  });

  test("drops schema parts that guide no call, and keeps the bounds that do", () => {
    const type = getListedToolInputSchema("odt_browser_type", { hideWorkspaceId: true });
    const pullRequest = getListedToolInputSchema("odt_set_pull_request", { hideWorkspaceId: true });
    const assets = getListedToolInputSchema("odt_read_task_assets", { hideWorkspaceId: true });

    expect(type).not.toHaveProperty("$schema");
    expect(propertiesOf(type).text).toEqual({ type: "string" });
    expect(propertiesOf(type).ref).toEqual({
      type: "string",
      minLength: 1,
      description: "Ref from the latest odt_browser_snapshot, such as e12.",
    });
    expect(propertiesOf(pullRequest).number).toEqual({ type: "integer", exclusiveMinimum: 0 });
    expect(propertiesOf(assets).assetIds).toEqual({
      minItems: 1,
      type: "array",
      items: { type: "string", format: "uuid" },
    });
    expect(
      getListedToolOutputSchema(ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_read_task),
    ).not.toHaveProperty("$schema");
  });
});
