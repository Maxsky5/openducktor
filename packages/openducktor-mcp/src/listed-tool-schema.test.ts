import { describe, expect, test } from "bun:test";
import { getListedToolInputSchema } from "./listed-tool-schema";

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
});
