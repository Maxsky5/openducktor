import { describe, expect, test } from "bun:test";
import {
  agentModelCatalogSchema,
  repoConfigSchema,
  settingsSnapshotSchema,
  taskCardSchema,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentMessageTarget,
  type AgentSessionModelSelection,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { createSessionTurnPreparation } from "./session-turn-preparation";

const target: AgentMessageTarget = {
  repoPath: "/repo",
  runtimeKind: "opencode",
  workingDirectory: "/repo/tree",
  externalSessionId: "saved",
  sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
};
const selected: AgentSessionModelSelection = {
  runtimeKind: "opencode",
  providerId: "provider",
  modelId: "current",
  profileId: "build",
  variant: "high",
};
const catalog = agentModelCatalogSchema.parse({
  runtime: RUNTIME_DESCRIPTORS_BY_KIND.opencode,
  models: [
    {
      id: "provider/current",
      providerId: "provider",
      providerName: "Provider",
      modelId: "current",
      modelName: "Current",
      variants: ["low", "high"],
      liveSessionUpdates: { variants: ["low"] },
    },
  ],
  defaultModelsByProvider: { provider: "current" },
  profiles: [{ name: "build", mode: "primary" }],
});
const setup = () => {
  let currentCatalog = catalog;
  let description = "First task context";
  const preparation = createSessionTurnPreparation({
    settings: {
      getRepoConfigByRepoPath: () =>
        Effect.succeed(
          repoConfigSchema.parse({
            workspaceId: "workspace",
            workspaceName: "Workspace",
            repoPath: "/repo",
          }),
        ),
      getSettingsSnapshot: () => Effect.succeed(settingsSnapshotSchema.parse({ theme: "system" })),
    },
    queries: {
      loadRuntimeCatalog: () =>
        Effect.succeed({ models: { status: "available", catalog: currentCatalog } }),
    },
    taskReader: {
      getTask: () =>
        Effect.succeed(
          taskCardSchema.parse({
            id: "task-1",
            title: "Current task",
            description,
            status: "in_progress",
            priority: 2,
            issueType: "task",
            aiReviewEnabled: true,
            createdAt: "2026-10-13T12:00:00Z",
            updatedAt: "2026-10-13T12:00:00Z",
          }),
        ),
    },
  });
  return {
    preparation,
    setDescription: (next: string) => {
      description = next;
    },
    setCatalog: (next: typeof catalog) => {
      currentCatalog = next;
    },
  };
};

describe("session turn preparation", () => {
  test("reads current task context for each new turn", async () => {
    const { preparation, setDescription } = setup();
    expect(await Effect.runPromise(preparation.context(target))).toContain("First task context");
    setDescription("Edited after the client snapshot");
    const prompt = await Effect.runPromise(preparation.context(target));
    expect(prompt).toContain("Edited after the client snapshot");
    expect(prompt).not.toContain("First task context");
  });

  test("preserves a valid saved variant while blocking an explicit forbidden live change", async () => {
    const { preparation } = setup();
    expect(await Effect.runPromise(preparation.model(target, selected))).toEqual(selected);
    const result = await Effect.runPromise(
      Effect.result(preparation.model(target, selected, { ...selected, variant: "low" })),
    );
    expect(result._tag).toBe("Failure");
  });

  test.each([{ profiles: [] }, { profiles: [{ name: "replacement", mode: "primary" as const }] }])(
    "requires explicit replacement for an obsolete profile",
    async ({ profiles }) => {
      const { preparation, setCatalog } = setup();
      setCatalog({ ...catalog, profiles: [...profiles] });
      const result = await Effect.runPromise(Effect.result(preparation.model(target, selected)));
      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { message: expect.stringContaining("Runtime Profile") },
      });
    },
  );

  test("an empty required profile catalog blocks a selection without a saved profile", async () => {
    const { preparation, setCatalog } = setup();
    setCatalog({ ...catalog, profiles: [] });
    const { profileId: _profileId, ...withoutProfile } = selected;
    expect(
      await Effect.runPromise(Effect.result(preparation.model(target, withoutProfile))),
    ).toMatchObject({
      _tag: "Failure",
      failure: { message: expect.stringContaining("catalog is empty") },
    });
  });

  test("rejects an invalid explicit configuration without choosing a replacement", async () => {
    const { preparation } = setup();
    const result = await Effect.runPromise(
      Effect.result(preparation.model(target, { ...selected, modelId: "obsolete" })),
    );
    expect(result._tag).toBe("Failure");
  });

  const claudeTarget: AgentMessageTarget = { ...target, runtimeKind: "claude" };
  const claudeModel = {
    id: "claude-opus-5-5",
    providerId: "claude",
    providerName: "Claude",
    modelId: "claude-opus-5-5",
    modelName: "Opus 5.5",
    variants: ["low", "max"],
    liveSessionUpdates: { variants: ["low"] },
  };

  describe("saved alias selections", () => {
    const aliasCatalog = agentModelCatalogSchema.parse({
      runtime: RUNTIME_DESCRIPTORS_BY_KIND.claude,
      models: [
        { ...claudeModel, aliases: ["opus"] },
        { ...claudeModel, id: "claude-haiku-5-5", modelId: "claude-haiku-5-5" },
      ],
      defaultModelsByProvider: { claude: "claude-haiku-5-5" },
    });
    const savedAlias: AgentSessionModelSelection = {
      runtimeKind: "claude",
      providerId: "claude",
      modelId: "opus",
      variant: "max",
    };
    test("accepts the model that an alias points to and keeps its variant", async () => {
      const { preparation, setCatalog } = setup();
      setCatalog(aliasCatalog);
      expect(await Effect.runPromise(preparation.model(claudeTarget, savedAlias))).toEqual({
        ...savedAlias,
        modelId: "claude-opus-5-5",
      });
    });
  });
});
