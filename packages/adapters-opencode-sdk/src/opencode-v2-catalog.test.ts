import { describe, expect, test } from "bun:test";
import type { AgentInfo } from "@opencode/client";
import { createController, ref, response } from "./opencode-v2.test-support";

const agents: AgentInfo[] = [
  {
    id: "build",
    name: "Build",
    mode: "primary",
    hidden: false,
    permissions: [],
    request: { settings: {}, headers: {}, body: {} },
  },
  {
    id: "explore",
    name: "Explore",
    mode: "subagent",
    hidden: false,
    permissions: [],
    request: { settings: {}, headers: {}, body: {} },
  },
];

describe("OpenCode V2 catalogs", () => {
  test("keeps other catalogs available when model metadata cannot be read", async () => {
    const { controller } = createController(({ url }) => {
      if (url.pathname === "/api/model") return response([]);
      if (url.pathname === "/api/provider")
        return Response.json({ message: "Provider read failed" }, { status: 503 });
      if (url.pathname === "/api/model/default") return response(null);
      if (url.pathname === "/api/agent") return response(agents);
      if (["/api/command", "/api/skill"].includes(url.pathname)) return response([]);
      throw new Error(`Unexpected catalog request ${url.pathname}`);
    });

    const catalog = await controller.loadRuntimeCatalog(ref);

    expect(catalog.models?.status).toBe("failed");
    if (catalog.models?.status === "failed") expect(catalog.models.cause).toBeInstanceOf(Error);
    expect(catalog.slashCommands?.status).toBe("available");
    expect(catalog.subagents).toEqual({
      status: "available",
      catalog: { subagents: [{ id: "explore", name: "explore" }] },
    });
    expect(catalog.skills).toEqual({ status: "available", catalog: { skills: [] } });
  });
});
