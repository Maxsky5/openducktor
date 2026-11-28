import { describe, expect, test } from "bun:test";
import type { AgentInfo, ModelInfo, ProviderInfo, SkillInfo } from "@opencode/client";
import { readModelCatalog } from "./opencode-catalog";
import { prepareFixture, readPreparedCatalogFixture } from "./opencode-v2-live.test-support";
import { nativeClient, ref, response } from "./opencode-v2.test-support";

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
  test("reads catalog surfaces in parallel", async () => {
    const data = nativeCatalog();
    const lists = ["/api/model", "/api/command", "/api/agent", "/api/skill"];
    const listed = new Set<string>();
    const allListed = Promise.withResolvers<void>();
    const { catalog, requests } = await readPreparedCatalogFixture(
      { ...ref, workingDirectory: "/repo/worktree" },
      async ({ url }) => {
        const path = url.pathname;
        listed.add(path);
        if (lists.every((list) => listed.has(list))) allListed.resolve();
        if (path === "/api/model") await allListed.promise;
        if (!data.has(path)) throw new Error(`Unexpected catalog request ${path}`);
        return response(data.get(path));
      },
    );

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
    const catalogRequests = requests.filter(({ url }) => url.pathname !== "/api/info");
    expect(catalogRequests[0]?.url.pathname).toBe("/api/plugin");
    expect(catalogRequests.filter(({ url }) => url.pathname === "/api/plugin")).toHaveLength(1);
    expect(catalogRequests.filter(({ url }) => url.pathname === "/api/model")).toHaveLength(1);
    expect(
      catalogRequests.every(
        ({ url }) => url.searchParams.get("location[directory]") === "/repo/worktree",
      ),
    ).toBe(true);
  });

  test("includes the cold checkout's plugin catalogs in the first response", async () => {
    const workingDirectory = "/repo/new-worktree";
    const canonicalDirectory = "/canonical/new-worktree";
    const data = nativeCatalog();
    const initialRead = Promise.withResolvers<void>();
    const coldInventory = Promise.withResolvers<Response>();
    const invalidated = Promise.withResolvers<void>();
    let pluginsLoaded = false;
    const fixture = prepareFixture(({ url }) => {
      const path = url.pathname;
      if (path === "/api/plugin") {
        if (!pluginsLoaded) {
          initialRead.resolve();
          return coldInventory.promise;
        }
        return Response.json({
          location: { directory: canonicalDirectory },
          data: [{ id: "opencode.agent", state: { status: "active" } }],
        });
      }
      if (data.has(path)) return response(pluginsLoaded ? data.get(path) : []);
      return undefined;
    });

    const runtime = await fixture.prepare();
    try {
      await runtime.startForwarding((signal) => {
        if (signal.type === "catalog_invalidated" && signal.workingDirectory === canonicalDirectory)
          invalidated.resolve();
      });
      const catalog = runtime.queries.loadRuntimeCatalog({ ...ref, workingDirectory });
      await initialRead.promise;
      pluginsLoaded = true;
      fixture.channel.push({
        type: "plugin.updated",
        id: "plugins-loaded",
        created: 1,
        location: { directory: canonicalDirectory },
        data: {},
      });

      await invalidated.promise;
      coldInventory.resolve(
        Response.json({ location: { directory: canonicalDirectory }, data: [] }),
      );

      const { models, slashCommands, subagents, skills } = await catalog;
      if (models?.status !== "available") throw new Error("Expected the model catalog");
      expect(models.catalog.profiles?.map(({ id }) => id)).toEqual(["build", "review"]);
      expect(models.catalog.models.map(({ modelId }) => modelId)).toEqual(["mimo-flash"]);
      expect(
        slashCommands?.status === "available" &&
          slashCommands.catalog.commands.map(({ trigger }) => trigger),
      ).toEqual(["inspect", "compact"]);
      expect(
        subagents?.status === "available" && subagents.catalog.subagents.map(({ id }) => id),
      ).toEqual(["review"]);
      expect(skills?.status === "available" && skills.catalog.skills.map(({ id }) => id)).toEqual([
        "native.review",
      ]);
    } finally {
      await runtime.release();
    }
  });

  test("reports plugin readiness failure for all catalog surfaces", async () => {
    const data = nativeCatalog();
    const fixture = prepareFixture(({ url }) => {
      if (url.pathname === "/api/plugin")
        return Response.json({ message: "Plugin inventory unavailable" }, { status: 503 });
      if (data.has(url.pathname)) return response(data.get(url.pathname));
      return undefined;
    });

    const runtime = await fixture.prepare();
    try {
      const { models, slashCommands, subagents, skills } =
        await runtime.queries.loadRuntimeCatalog(ref);

      for (const surface of [models, slashCommands, subagents, skills]) {
        expect(surface).toMatchObject({
          status: "failed",
          cause: expect.any(Error),
        });
      }
    } finally {
      await runtime.release();
    }
  });

  test("keeps other catalogs available when the model list fails", async () => {
    const data = nativeCatalog();
    const { catalog } = await readPreparedCatalogFixture(ref, ({ url }) => {
      if (url.pathname === "/api/model")
        return Response.json({ message: "Model list failed" }, { status: 503 });
      return response(data.get(url.pathname));
    });

    expect(catalog.models?.status).toBe("failed");
    expect(catalog.slashCommands?.status).toBe("available");
    expect(catalog.subagents?.status).toBe("available");
    expect(catalog.skills?.status).toBe("available");
  });

  test("keeps other catalogs available when provider metadata fails", async () => {
    const data = nativeCatalog();
    const { catalog } = await readPreparedCatalogFixture(ref, ({ url }) => {
      if (url.pathname === "/api/provider")
        return Response.json({ message: "Provider metadata failed" }, { status: 503 });
      return response(data.get(url.pathname));
    });

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
