import { describe, expect, test } from "bun:test";
import { ODT_HOST_BRIDGE_RESPONSE_SCHEMAS } from "./lib";
import { getListedToolInputSchema, getListedToolOutputSchema } from "./listed-tool-schema";

type ListedToolSchema = ReturnType<typeof getListedToolInputSchema>;

const propertiesOf = (jsonSchema: ListedToolSchema): NonNullable<ListedToolSchema["properties"]> =>
  jsonSchema.properties ?? {};

const requiredOf = (jsonSchema: ListedToolSchema): string[] => jsonSchema.required ?? [];

const activeStatuses = ["open", "in_progress"];
const hidden = { hideWorkspaceId: true };

describe("listed MCP tool input schema", () => {
  test("hides workspaceId from listed tools when the MCP server is already workspace-scoped", () => {
    const schema = getListedToolInputSchema("odt_read_task", {
      hideWorkspaceId: true,
      activeStatuses,
    });
    const properties = propertiesOf(schema);

    expect(properties).toHaveProperty("taskId");
    expect(properties).not.toHaveProperty("workspaceId");
    expect(requiredOf(schema)).not.toContain("workspaceId");
  });

  test("lists the fixed issue types and the active states of the host as a hint", () => {
    const create = propertiesOf(
      getListedToolInputSchema("odt_create_task", { ...hidden, activeStatuses: ["todo"] }),
    );
    const search = propertiesOf(
      getListedToolInputSchema("odt_search_tasks", {
        ...hidden,
        activeStatuses: ["todo", "doing"],
      }),
    );

    expect(create.issueType).toMatchObject({ enum: ["task", "feature", "bug"] });
    expect(create).not.toHaveProperty("status");
    expect(search.status).toEqual({
      type: "string",
      enum: ["todo", "doing"],
      description: "A state that is not terminal.",
    });
  });

  test("keeps workspaceId in listed tools for external MCP clients", () => {
    const properties = propertiesOf(
      getListedToolInputSchema("odt_read_task", { hideWorkspaceId: false, activeStatuses }),
    );

    expect(properties).toHaveProperty("workspaceId");
  });

  test("lists the task asset batch fields while hiding the bound workspace", () => {
    const schema = getListedToolInputSchema("odt_read_task_assets", {
      hideWorkspaceId: true,
      activeStatuses,
    });
    const properties = propertiesOf(schema);

    expect(properties).toHaveProperty("taskId");
    expect(properties).toHaveProperty("assetIds");
    expect(properties).not.toHaveProperty("workspaceId");
    expect(requiredOf(schema)).toEqual(expect.arrayContaining(["taskId", "assetIds"]));
  });

  test("drops schema parts that guide no call, and keeps the bounds that do", () => {
    const type = getListedToolInputSchema("odt_browser_type", {
      hideWorkspaceId: true,
      activeStatuses,
    });
    const pullRequest = getListedToolInputSchema("odt_set_pull_request", {
      hideWorkspaceId: true,
      activeStatuses,
    });
    const assets = getListedToolInputSchema("odt_read_task_assets", {
      hideWorkspaceId: true,
      activeStatuses,
    });

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
