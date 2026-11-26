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
  test("reads every catalog at once, because no OpenCode list waits for plugins", async () => {
    const data = nativeCatalog();
    const lists = ["/api/model", "/api/command", "/api/agent", "/api/skill"];
    const listed = new Set<string>();
    const allListed = Promise.withResolvers<void>();
    const { controller, requests } = createController(async ({ url }) => {
      const path = url.pathname;
      listed.add(path);
      if (lists.every((list) => listed.has(list))) allListed.resolve();
      if (path === "/api/model") await allListed.promise;
      if (!data.has(path)) throw new Error(`Unexpected catalog request ${path}`);
      return response(data.get(path));
    });

    const catalog = await controller.loadRuntimeCatalog({
      ...ref,
      workingDirectory: "/repo/worktree",
    });

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

  test("keeps other catalogs available when the model list fails", async () => {
    const data = nativeCatalog();
    const { controller } = createController(({ url }) => {
      if (url.pathname === "/api/model")
        return Response.json({ message: "Model list failed" }, { status: 503 });
      return response(data.get(url.pathname));
    });

    const catalog = await controller.loadRuntimeCatalog(ref);

    expect(catalog.models?.status).toBe("failed");
    expect(catalog.slashCommands?.status).toBe("available");
    expect(catalog.subagents?.status).toBe("available");
    expect(catalog.skills?.status).toBe("available");
  });

  test("keeps other catalogs available when provider metadata fails", async () => {
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
