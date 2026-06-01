import { describe, expect, test } from "bun:test";
import {
  AUTOPILOT_EVENT_IDS,
  chatSettingsSchema,
  DEFAULT_AGENT_RUNTIMES,
  globalConfigSchema,
  KANBAN_EMPTY_COLUMN_DISPLAY_VALUES,
  kanbanSettingsSchema,
  repoConfigSchema,
  reusablePromptSchema,
  reusablePromptsSchema,
  settingsSnapshotSchema,
} from "./config-schemas";

const baseRepoConfigInput = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
};

describe("config-schemas", () => {
  test("defaults dev servers to an empty array", () => {
    const parsed = repoConfigSchema.parse(baseRepoConfigInput);
    expect(parsed.devServers).toEqual([]);
  });

  test("ignores legacy trusted hook fields", () => {
    const parsed = repoConfigSchema.parse({
      ...baseRepoConfigInput,
      trustedHooks: true,
      trustedHooksFingerprint: "legacy-fingerprint",
    });

    expect(parsed).not.toHaveProperty("trustedHooks");
    expect(parsed).not.toHaveProperty("trustedHooksFingerprint");
  });

  test("requires named dev server commands", () => {
    expect(() =>
      repoConfigSchema.parse({
        ...baseRepoConfigInput,
        devServers: [
          {
            id: "frontend",
            name: "",
            command: "bun run dev",
          },
        ],
      }),
    ).toThrow();
  });

  test("trims dev server fields and rejects duplicate ids", () => {
    const parsed = repoConfigSchema.parse({
      ...baseRepoConfigInput,
      devServers: [
        {
          id: " frontend ",
          name: " Frontend ",
          command: " bun run dev ",
        },
      ],
    });

    expect(parsed.devServers).toEqual([
      {
        id: "frontend",
        name: "Frontend",
        command: "bun run dev",
      },
    ]);

    expect(() =>
      repoConfigSchema.parse({
        ...baseRepoConfigInput,
        devServers: [
          { id: "frontend", name: "Frontend", command: "bun run dev" },
          { id: " frontend ", name: "Backend", command: "bun run api" },
        ],
      }),
    ).toThrow("Duplicate dev server id: frontend");
  });

  test("rejects whitespace-only dev server fields", () => {
    expect(() =>
      repoConfigSchema.parse({
        ...baseRepoConfigInput,
        devServers: [{ id: "frontend", name: "Frontend", command: "   " }],
      }),
    ).toThrow("Dev server command cannot be blank.");
  });

  test("requires explicit repo runtime kind", () => {
    expect(() => repoConfigSchema.parse({})).toThrow();
  });

  test("defaults kanban settings for existing snapshots", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsed.kanban.doneVisibleDays).toBe(1);
    expect(parsed.kanban.emptyColumnDisplay).toBe("show");
    expect(parsed.reusablePrompts).toEqual([]);
  });

  test("defaults general background Agent Studio tab setting for existing snapshots", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsed.general.openAgentStudioTabOnBackgroundSessionStart).toBe(true);
  });

  test("defaults agent runtime enablement for global config and snapshots", () => {
    const snapshot = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });
    const globalConfig = globalConfigSchema.parse({
      version: 2,
      theme: "light",
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(snapshot.agentRuntimes).toEqual(DEFAULT_AGENT_RUNTIMES);
    expect(globalConfig.agentRuntimes).toEqual(DEFAULT_AGENT_RUNTIMES);
  });

  test("roundtrips explicit disabled background Agent Studio tab setting", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      general: { openAgentStudioTabOnBackgroundSessionStart: false },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsed.general.openAgentStudioTabOnBackgroundSessionStart).toBe(false);
  });

  test("keeps chat settings scoped to chat display", () => {
    const parsed = chatSettingsSchema.parse({ showThinkingMessages: true });

    expect(parsed).toEqual({
      showThinkingMessages: true,
      expandFileDiffsByDefault: true,
    });
  });

  test("defaults file diff expansion for older chat settings", () => {
    const parsed = chatSettingsSchema.parse({ showThinkingMessages: false });

    expect(parsed).toEqual({
      showThinkingMessages: false,
      expandFileDiffsByDefault: true,
    });
  });

  test("roundtrips explicit file diff expansion settings", () => {
    const parsedSnapshot = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      chat: { showThinkingMessages: true, expandFileDiffsByDefault: false },
      workspaces: {},
      globalPromptOverrides: {},
    });
    const parsedGlobalConfig = globalConfigSchema.parse({
      version: 2,
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      chat: { showThinkingMessages: false, expandFileDiffsByDefault: false },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsedSnapshot.chat).toEqual({
      showThinkingMessages: true,
      expandFileDiffsByDefault: false,
    });
    expect(parsedGlobalConfig.chat).toEqual({
      showThinkingMessages: false,
      expandFileDiffsByDefault: false,
    });
  });

  test("defaults reusable prompts to an empty array", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      chat: { showThinkingMessages: true },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsed.reusablePrompts).toEqual([]);
  });

  test("trims and roundtrips valid reusable prompts", () => {
    const parsed = reusablePromptSchema.parse({
      id: " prompt-1 ",
      name: " review-file ",
      description: " Review a file ",
      content: " Review this:\n$ARGUMENTS ",
    });

    expect(parsed).toEqual({
      id: "prompt-1",
      name: "review-file",
      description: "Review a file",
      content: "Review this:\n$ARGUMENTS",
    });
  });

  test("rejects invalid reusable prompt fields", () => {
    expect(() =>
      reusablePromptsSchema.parse([
        { id: "prompt-1", name: "bad name", description: "", content: "Body" },
      ]),
    ).toThrow("Reusable prompt name must contain only letters");

    expect(() =>
      reusablePromptsSchema.parse([
        { id: "prompt-1", name: "review", description: "", content: "  " },
      ]),
    ).toThrow("Reusable prompt content cannot be blank.");
  });

  test("rejects duplicate reusable prompt names case-insensitively", () => {
    expect(() =>
      reusablePromptsSchema.parse([
        { id: "prompt-1", name: "review", description: "", content: "Body" },
        { id: "prompt-2", name: " Review ", description: "", content: "Body" },
      ]),
    ).toThrow("Duplicate reusable prompt name: Review");
  });

  test("reports duplicate reusable prompt names against the first occurrence", () => {
    const result = reusablePromptsSchema.safeParse([
      { id: "prompt-1", name: "review", description: "", content: "Body" },
      { id: "prompt-2", name: " Review ", description: "", content: "Body" },
      { id: "prompt-3", name: "REVIEW", description: "", content: "Body" },
    ]);

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("duplicate names should fail validation");
    }
    expect(result.error.issues.map((issue) => issue.path.join("."))).toEqual([
      "1.name",
      "0.name",
      "2.name",
      "0.name",
    ]);
  });

  test("rejects duplicate reusable prompt ids", () => {
    expect(() =>
      reusablePromptsSchema.parse([
        { id: "prompt-1", name: "review", description: "", content: "Body" },
        { id: " prompt-1 ", name: "summarize", description: "", content: "Body" },
      ]),
    ).toThrow("Duplicate reusable prompt id: prompt-1");
  });

  test("defaults missing kanban empty-column display to show", () => {
    const parsed = kanbanSettingsSchema.parse({ doneVisibleDays: 4 });

    expect(parsed).toEqual({ doneVisibleDays: 4, emptyColumnDisplay: "show" });
  });

  test("accepts every supported kanban empty-column display mode", () => {
    for (const emptyColumnDisplay of KANBAN_EMPTY_COLUMN_DISPLAY_VALUES) {
      expect(kanbanSettingsSchema.parse({ doneVisibleDays: 1, emptyColumnDisplay })).toEqual({
        doneVisibleDays: 1,
        emptyColumnDisplay,
      });
    }
  });

  test("rejects invalid kanban empty-column display modes", () => {
    expect(() =>
      kanbanSettingsSchema.parse({ doneVisibleDays: 1, emptyColumnDisplay: "compact" }),
    ).toThrow();
  });

  test("defaults autopilot rules for every supported event", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsed.autopilot.rules.map((rule) => rule.eventId)).toEqual([...AUTOPILOT_EVENT_IDS]);
    expect(parsed.autopilot.rules.every((rule) => rule.actionIds.length === 0)).toBe(true);
  });

  test("creates a fresh autopilot default for each parse", () => {
    const first = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });
    const second = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(first.autopilot).not.toBe(second.autopilot);
    expect(first.autopilot.rules).not.toBe(second.autopilot.rules);
  });

  test("normalizes autopilot rule order and dedupes actions", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
      autopilot: {
        rules: [
          {
            eventId: "taskProgressedToHumanReview",
            actionIds: ["startGeneratePullRequest", "startGeneratePullRequest"],
          },
          {
            eventId: "taskProgressedToSpecReady",
            actionIds: ["startPlanner", "startPlanner"],
          },
        ],
      },
    });

    expect(parsed.autopilot.rules).toEqual([
      { eventId: "taskProgressedToSpecReady", actionIds: ["startPlanner"] },
      { eventId: "taskProgressedToReadyForDev", actionIds: [] },
      { eventId: "taskProgressedToAiReview", actionIds: [] },
      { eventId: "taskRejectedByQa", actionIds: [] },
      { eventId: "taskProgressedToHumanReview", actionIds: ["startGeneratePullRequest"] },
    ]);
  });

  test("merges duplicate rules for the same event", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
      autopilot: {
        rules: [
          {
            eventId: "taskProgressedToSpecReady",
            actionIds: ["startPlanner"],
          },
          {
            eventId: "taskProgressedToSpecReady",
            actionIds: ["startBuilder", "startPlanner"],
          },
        ],
      },
    });

    expect(parsed.autopilot.rules[0]).toEqual({
      eventId: "taskProgressedToSpecReady",
      actionIds: ["startPlanner", "startBuilder"],
    });
  });
});
