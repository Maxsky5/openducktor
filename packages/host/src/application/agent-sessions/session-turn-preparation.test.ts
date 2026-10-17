import { describe, expect, test } from "bun:test";
import {
  agentModelCatalogSchema,
  agentSessionHistorySchema,
  repoConfigSchema,
  settingsSnapshotSchema,
  taskCardSchema,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type AgentMessageTarget,
  type AgentSessionHistoryMessage,
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
const setup = (history: AgentSessionHistoryMessage[] = []) => {
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
      loadSessionHistory: () => Effect.succeed(history),
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

describe("authoritative turn preparation", () => {
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
    expect(await Effect.runPromise(preparation.model(target, selected))).toEqual({
      kind: "keep",
      selection: selected,
    });
    const result = await Effect.runPromise(
      Effect.result(
        preparation.model(target, selected, {
          captured: true,
          previous: { ...selected, variant: "low" },
        }),
      ),
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

  test("validates a captured queued choice without changing it", async () => {
    const { preparation } = setup();
    const result = await Effect.runPromise(
      Effect.result(
        preparation.model(target, { ...selected, modelId: "obsolete" }, { captured: true }),
      ),
    );
    expect(result._tag).toBe("Failure");
    expect(
      await Effect.runPromise(preparation.model(target, { ...selected, modelId: "obsolete" })),
    ).toMatchObject({
      kind: "repair",
      selection: { modelId: "current", profileId: "build", variant: "low" },
    });
  });

  describe("Claude models", () => {
    const claudeTarget: AgentMessageTarget = { ...target, runtimeKind: "claude" };
    const claudeCatalog = agentModelCatalogSchema.parse({
      runtime: RUNTIME_DESCRIPTORS_BY_KIND.claude,
      models: [
        {
          id: "claude-opus-5-5",
          providerId: "claude",
          providerName: "Claude",
          modelId: "claude-opus-5-5",
          modelName: "Opus 5.5",
          aliases: ["opus"],
          variants: [],
          attachmentSupport: {
            image: true,
            audio: false,
            video: false,
            pdf: true,
            mimeTypes: { image: ["image/png"] },
          },
        },
        {
          id: "claude-haiku-5-5",
          providerId: "claude",
          providerName: "Claude",
          modelId: "claude-haiku-5-5",
          modelName: "Haiku 5.5",
          aliases: ["haiku", "default"],
          variants: [],
        },
      ],
      defaultModelsByProvider: { claude: "claude-haiku-5-5" },
    });
    const imagePart = {
      kind: "attachment" as const,
      attachment: {
        id: "attachment-1",
        path: "/tmp/image.png",
        name: "image.png",
        kind: "image" as const,
        mime: "image/png",
      },
    };
    const turnHistory = (modelId: string) =>
      agentSessionHistorySchema.parse([
        {
          messageId: "user-1",
          role: "user",
          timestamp: "2026-10-17T12:00:00Z",
          text: "Start",
          displayParts: [],
          state: "read",
          parts: [],
        },
        {
          messageId: "assistant-1",
          role: "assistant",
          timestamp: "2026-10-17T12:00:01Z",
          text: "Working",
          model: { runtimeKind: "claude", providerId: "claude", modelId },
          parts: [],
        },
      ]);

    test("accepts a steer attachment that suits the model that the turn reports", async () => {
      const { preparation, setCatalog } = setup(turnHistory("claude-opus-5-5"));
      setCatalog(claudeCatalog);

      await Effect.runPromise(preparation.steeringContent(claudeTarget, [imagePart]));
    });

    test("rejects a steer attachment when the catalog lacks the model of the turn", async () => {
      const { preparation, setCatalog } = setup(turnHistory("claude-unknown"));
      setCatalog(claudeCatalog);

      const result = await Effect.runPromise(
        Effect.result(preparation.steeringContent(claudeTarget, [imagePart])),
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          message:
            "image.png: The model of the running turn does not expose attachment capability data.",
        },
      });
    });

    test("converts a saved alias to the model that it points to", async () => {
      const { preparation, setCatalog } = setup();
      setCatalog(claudeCatalog);

      expect(
        await Effect.runPromise(
          preparation.model(claudeTarget, {
            runtimeKind: "claude",
            providerId: "claude",
            modelId: "opus",
          }),
        ),
      ).toMatchObject({ kind: "repair", selection: { modelId: "claude-opus-5-5" } });
    });
  });
});
