import { describe, expect, test } from "bun:test";
import {
  AUTOPILOT_EVENT_IDS,
  chatSettingsSchema,
  codexRuntimeConfigSchema,
  DEFAULT_AGENT_RUNTIMES,
  DEFAULT_CODEX_RUNTIME_POLICY,
  globalConfigSchema,
  KANBAN_EMPTY_COLUMN_DISPLAY_VALUES,
  kanbanSettingsSchema,
  repoConfigSchema,
  resolveCodexEffectivePolicy,
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

  test("defaults missing and enabled-only codex runtime config", () => {
    const missing = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });
    const enabledOnly = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      agentRuntimes: { codex: { enabled: true } },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(missing.agentRuntimes.codex).toEqual({
      enabled: false,
      defaults: DEFAULT_CODEX_RUNTIME_POLICY,
      roleOverrides: {},
    });
    expect(enabledOnly.agentRuntimes.codex).toEqual({
      enabled: true,
      defaults: DEFAULT_CODEX_RUNTIME_POLICY,
      roleOverrides: {},
    });
  });

  test("preserves enabled-only opencode and unknown runtime config", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      agentRuntimes: { opencode: { enabled: false }, custom: { enabled: true } },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsed.agentRuntimes.opencode).toEqual({ enabled: false });
    expect((parsed.agentRuntimes as Record<string, unknown>).custom).toEqual({ enabled: true });
  });

  test("accepts narrow codex policy values and role overrides", () => {
    const parsed = codexRuntimeConfigSchema.parse({
      enabled: true,
      defaults: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        workspaceWriteNetworkAccess: true,
      },
      roleOverrides: {
        spec: { sandboxMode: "read-only", approvalPolicy: "untrusted" },
        planner: { approvalsReviewer: "user" },
        build: { sandboxMode: "workspace-write" },
        qa: { workspaceWriteNetworkAccess: false },
      },
    });

    expect(parsed.roleOverrides.build?.sandboxMode).toBe("workspace-write");
  });

  test("resolves codex policy with override precedence and builder inheritance adjustment", () => {
    const config = codexRuntimeConfigSchema.parse({
      enabled: true,
      defaults: {
        sandboxMode: "read-only",
        approvalPolicy: "untrusted",
        approvalsReviewer: "auto_review",
        workspaceWriteNetworkAccess: true,
      },
      roleOverrides: {
        qa: { sandboxMode: "workspace-write", workspaceWriteNetworkAccess: true },
      },
    });

    expect(resolveCodexEffectivePolicy(config, "qa")).toEqual({
      sandboxMode: "workspace-write",
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      approvalsReviewerApplies: true,
      workspaceWriteNetworkAccess: true,
    });
    expect(resolveCodexEffectivePolicy(config, "spec")).toEqual({
      sandboxMode: "read-only",
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      approvalsReviewerApplies: true,
      workspaceWriteNetworkAccess: false,
    });
    expect(resolveCodexEffectivePolicy(config, "build")).toEqual({
      sandboxMode: "workspace-write",
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      approvalsReviewerApplies: true,
      workspaceWriteNetworkAccess: true,
      adjustmentReason:
        "Build role requires workspace-write when sandboxMode is inherited from read-only.",
    });
  });

  test("rejects dangerous explicit codex read-only role overrides", () => {
    expect(() =>
      codexRuntimeConfigSchema.parse({
        enabled: true,
        roleOverrides: {
          spec: { approvalPolicy: "never" },
          qa: { sandboxMode: "danger-full-access" },
        },
      }),
    ).toThrow("Codex spec role approvalPolicy cannot be never.");
  });

  test("rejects dangerous inherited codex policy for read-only roles", () => {
    const result = codexRuntimeConfigSchema.safeParse({
      enabled: true,
      defaults: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        workspaceWriteNetworkAccess: false,
      },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "Codex spec role effective sandboxMode cannot be danger-full-access.",
    );
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toContain(
      "defaults.sandboxMode",
    );
  });

  test("allows dangerous codex defaults when read-only roles explicitly override safely", () => {
    const config = codexRuntimeConfigSchema.parse({
      enabled: true,
      defaults: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        workspaceWriteNetworkAccess: false,
      },
      roleOverrides: {
        spec: { sandboxMode: "workspace-write", approvalPolicy: "on-request" },
        planner: { sandboxMode: "read-only", approvalPolicy: "untrusted" },
        qa: { sandboxMode: "workspace-write", approvalPolicy: "on-request" },
      },
    });

    expect(resolveCodexEffectivePolicy(config, "spec")).toMatchObject({
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });
    expect(resolveCodexEffectivePolicy(config, "build")).toMatchObject({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
  });

  test("creates fresh codex default policy objects for each parse", () => {
    const first = codexRuntimeConfigSchema.parse({ enabled: true });
    const second = codexRuntimeConfigSchema.parse({ enabled: true });
    const firstSnapshot = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });
    const secondSnapshot = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(first.defaults).toEqual(DEFAULT_CODEX_RUNTIME_POLICY);
    expect(first.defaults).not.toBe(DEFAULT_CODEX_RUNTIME_POLICY);
    expect(first.defaults).not.toBe(second.defaults);
    expect(firstSnapshot.agentRuntimes.codex.defaults).not.toBe(
      secondSnapshot.agentRuntimes.codex.defaults,
    );
  });

  test("rejects explicit builder read-only sandbox with field path", () => {
    const result = codexRuntimeConfigSchema.safeParse({
      enabled: true,
      roleOverrides: { build: { sandboxMode: "read-only" } },
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("explicit builder read-only must fail");
    expect(result.error.issues[0]?.path.join(".")).toBe("roleOverrides.build.sandboxMode");
    expect(result.error.issues[0]?.message).toContain("build role sandboxMode cannot be read-only");
  });

  test("rejects invalid codex values and out-of-scope keys", () => {
    for (const value of ["on-failure", "guardian_subagent", { mode: "on-request" }]) {
      expect(() =>
        codexRuntimeConfigSchema.parse({ enabled: true, defaults: { approvalPolicy: value } }),
      ).toThrow();
    }

    for (const key of [
      "sandboxMode",
      "approvalPolicy",
      "guardian_subagent",
      "networkProxy",
      "domainPolicy",
      "writableRoots",
      "permissionProfile",
      "webSearch",
    ]) {
      expect(() => codexRuntimeConfigSchema.parse({ enabled: true, [key]: true })).toThrow();
    }

    expect(() =>
      codexRuntimeConfigSchema.parse({ enabled: true, roleOverrides: { review: {} } }),
    ).toThrow("Unsupported Codex role override: review");
    expect(() =>
      codexRuntimeConfigSchema.parse({ enabled: true, defaults: { sandboxMode: "workspace" } }),
    ).toThrow();
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
