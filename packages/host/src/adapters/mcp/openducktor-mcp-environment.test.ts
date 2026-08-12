import { describe, expect, test } from "bun:test";
import { ODT_MCP_TOOL_NAMES } from "@openducktor/contracts";
import {
  buildOpenDucktorMcpBridgeEnvironment,
  OPENDUCKTOR_MCP_ENV_VAR_NAMES,
} from "./openducktor-mcp-environment";

describe("OpenDucktor managed MCP environment", () => {
  test("routes through the explicit bridge without injecting a discovery channel", () => {
    const environment = buildOpenDucktorMcpBridgeEnvironment(
      {
        hostToken: "host-token",
        hostUrl: "http://127.0.0.1:14327",
        workspaceId: "workspace-1",
      },
      "Codex",
    );

    expect(environment.ODT_HOST_URL).toBe("http://127.0.0.1:14327");
    expect(environment.ODT_HOST_TOKEN).toBe("host-token");
    expect(environment.ODT_ALLOWED_TOOLS).toBe(ODT_MCP_TOOL_NAMES.join(","));
    expect(environment.ODT_ALLOWED_TOOLS).toContain("odt_create_task");
    expect(environment.ODT_ALLOWED_TOOLS).toContain("odt_search_tasks");
    expect(environment).not.toHaveProperty("OPENDUCKTOR_CHANNEL");
    expect(OPENDUCKTOR_MCP_ENV_VAR_NAMES).not.toContain("OPENDUCKTOR_CHANNEL");
  });
});
