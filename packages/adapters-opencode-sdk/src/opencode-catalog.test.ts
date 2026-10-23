import { describe, expect, test } from "bun:test";
import type { AgentInfo, ModelInfo, ProviderInfo, SkillInfo } from "@opencode/client";
import { readModelCatalog } from "./opencode-catalog";
import { createController, nativeClient, ref, response } from "./opencode-v2.test-support";

const nativeCatalog = (variants: ModelInfo["variants"] = []) =>
  new Map(
    Object.entries({
      "/api/model": [
        {
          id: "mimo-flash",
          modelID: "mimo-flash",
          providerID: "opencode",
          name: "MiMo Flash",
          capabilities: { tools: true, input: ["text"], output: ["text"] },
          variants,
          time: { released: 1 },
          cost: [],
          status: "active",
          enabled: true,
          limit: { context: 100000, output: 8192 },
        },
      ] satisfies ModelInfo[],
      "/api/model/default": { providerID: "opencode", id: "mimo-flash" },
      "/api/provider": [
        { id: "opencode", name: "OpenCode Zen", activation: "enabled", package: "@opencode/ai" },
      ] satisfies ProviderInfo[],
      "/api/agent": [
        {
          id: "build",
          name: "Build",
          mode: "primary",
          hidden: false,
          request: {},
          permissions: [],
        },
        {
          id: "review",
          name: "Review",
          mode: "subagent",
          hidden: false,
          description: "Review the change.",
          request: {},
          permissions: [],
        },
      ] satisfies AgentInfo[],
      "/api/command": [{ name: "inspect", description: "Inspect the project." }],
      "/api/skill": [
        {
          id: "native.review",
          name: "review",
          path: "/repo/.agents/skills/review/SKILL.md",
          content: "Review instructions.",
        },
      ] satisfies SkillInfo[],
    }),
  );

describe("OpenCode catalog", () => {
  test("waits for cold location plugins before reading their catalogs", async () => {
    const data = nativeCatalog();
    const modelStarted = Promise.withResolvers<void>();
    const activatePlugins = Promise.withResolvers<void>();
    let pluginsReady = false;
    const { controller, requests } = createController(async ({ url }) => {
      const path = url.pathname;
      if (path === "/api/model") {
        modelStarted.resolve();
        await activatePlugins.promise;
        pluginsReady = true;
      } else if (path === "/api/model/default") {
        await activatePlugins.promise;
      } else if (!pluginsReady) {
        return response([]);
      }
      if (!data.has(path)) throw new Error(`Unexpected catalog request ${path}`);
      return response(data.get(path));
    });

    const pending = controller.loadRuntimeCatalog({ ...ref, workingDirectory: "/repo/worktree" });
    await modelStarted.promise;
    activatePlugins.resolve();
    const catalog = await pending;

    expect(catalog.models).toMatchObject({
      status: "available",
      catalog: {
        models: [{ providerName: "OpenCode Zen" }],
        profiles: [
          { id: "build", mode: "primary" },
          { id: "review", mode: "subagent" },
        ],
      },
    });
    expect(catalog.slashCommands).toMatchObject({
      status: "available",
      catalog: {
        commands: expect.arrayContaining([
          {
            id: "command:inspect",
            trigger: "inspect",
            title: "inspect",
            source: "command",
            hints: [],
            description: "Inspect the project.",
          },
        ]),
      },
    });
    expect(catalog.subagents).toEqual({
      status: "available",
      catalog: { subagents: [{ id: "review", name: "review", description: "Review the change." }] },
    });
    expect(catalog.skills).toEqual({
      status: "available",
      catalog: {
        skills: [
          { id: "native.review", name: "review", path: "/repo/.agents/skills/review/SKILL.md" },
        ],
      },
    });
    expect(requests.filter(({ url }) => url.pathname === "/api/model")).toHaveLength(1);
    expect(
      requests.every(({ url }) => url.searchParams.get("location[directory]") === "/repo/worktree"),
    ).toBe(true);
  });

  test("reports a model readiness failure for every dependent catalog", async () => {
    const { controller, requests } = createController(({ url }) => {
      if (url.pathname === "/api/model")
        return Response.json(
          { message: "Location plugins did not finish activating" },
          { status: 503 },
        );
      return response([]);
    });

    const catalog = await controller.loadRuntimeCatalog(ref);

    expect(catalog.models?.status).toBe("failed");
    expect(catalog.slashCommands?.status).toBe("failed");
    expect(catalog.subagents?.status).toBe("failed");
    expect(catalog.skills?.status).toBe("failed");
    expect(requests.map(({ url }) => url.pathname)).toEqual(["/api/model"]);
  });

  test("keeps other catalogs available when provider metadata fails after plugin activation", async () => {
    const data = nativeCatalog();
    const { controller } = createController(({ url }) => {
      if (url.pathname === "/api/provider")
        return Response.json({ message: "Provider metadata failed" }, { status: 503 });
      return response(data.get(url.pathname));
    });

    const catalog = await controller.loadRuntimeCatalog(ref);

    expect(catalog.models?.status).toBe("failed");
    expect(catalog.slashCommands?.status).toBe("available");
    expect(catalog.subagents?.status).toBe("available");
    expect(catalog.skills?.status).toBe("available");
  });

  test.each([
    { declared: [], expected: ["default"] },
    { declared: ["high", "low"], expected: ["default", "high", "low"] },
    { declared: ["high", "default", "low"], expected: ["default", "high", "low"] },
  ])(
    "includes the implicit default variant with declared $declared variants",
    async ({ declared, expected }) => {
      const data = nativeCatalog(declared.map((id) => ({ id })));
      const client = nativeClient(({ url }) => response(data.get(url.pathname)));

      const catalog = await readModelCatalog(client, "/repo/worktree");

      expect(catalog.models[0]?.variants).toEqual(expected);
    },
  );
});
