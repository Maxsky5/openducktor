import { describe, expect, test } from "bun:test";
import {
  APP_PLATFORM_VALUES,
  AUTOPILOT_EVENT_IDS,
  appearanceSettingsSchema,
  appPlatformSchema,
  CHAT_DIFF_HEIGHT_VALUES,
  CHAT_DIFF_INDICATOR_VALUES,
  CHAT_DIFF_STYLE_VALUES,
  CHAT_HUNK_SEPARATOR_VALUES,
  CHAT_LINE_OVERFLOW_VALUES,
  chatSettingsSchema,
  codexRuntimeConfigSchema,
  DEFAULT_AGENT_RUNTIMES,
  DEFAULT_APPEARANCE_SETTINGS,
  DEFAULT_CHAT_SETTINGS,
  DEFAULT_CODEX_RUNTIME_POLICY,
  globalConfigSchema,
  HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES,
  KANBAN_EMPTY_COLUMN_DISPLAY_VALUES,
  kanbanSettingsSchema,
  repoConfigSchema,
  resolveCodexEffectivePolicy,
  resolveHorizontalScrollbarVisibility,
  reusablePromptSchema,
  reusablePromptsSchema,
  settingsSnapshotSaveInputSchema,
  settingsSnapshotSchema,
} from "./config-schemas";

const baseRepoConfigInput = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "opencode",
};

const expectedDefaultChatSettings = {
  showThinkingMessages: false,
  expandFileDiffsByDefault: true,
  diffStyle: "split",
  diffIndicators: "bars",
  diffHeight: "full",
  lineOverflow: "wrap",
  hunkSeparators: "line-info",
} as const;

describe("config-schemas", () => {
  test("limits bulk settings saves to explicitly owned fields", () => {
    expect(settingsSnapshotSaveInputSchema.keyof().options).toEqual([
      "git",
      "general",
      "appearance",
      "chat",
      "reusablePrompts",
      "kanban",
      "autopilot",
      "agentRuntimes",
      "workspaces",
      "globalPromptOverrides",
    ]);
    expect(settingsSnapshotSaveInputSchema.safeParse({}).success).toBe(false);
    expect(
      settingsSnapshotSaveInputSchema.safeParse({
        git: { defaultMergeMethod: "merge_commit" },
      }).success,
    ).toBe(false);
  });

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

  test("defaults appearance settings for existing configs and snapshots", () => {
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

    expect(snapshot.appearance).toEqual(DEFAULT_APPEARANCE_SETTINGS);
    expect(globalConfig.appearance).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  test("accepts and rejects horizontal scrollbar appearance modes", () => {
    for (const horizontalScrollbarVisibility of HORIZONTAL_SCROLLBAR_VISIBILITY_VALUES) {
      expect(
        appearanceSettingsSchema.parse({
          horizontalScrollbarVisibility,
        }).horizontalScrollbarVisibility,
      ).toBe(horizontalScrollbarVisibility);
    }

    expect(() =>
      appearanceSettingsSchema.parse({
        horizontalScrollbarVisibility: "auto",
      }),
    ).toThrow();
  });

  test("resolves horizontal scrollbar visibility from explicit modes and supported platforms", () => {
    expect(resolveHorizontalScrollbarVisibility("show")).toBe("show");
    expect(resolveHorizontalScrollbarVisibility("hide")).toBe("hide");
    expect(resolveHorizontalScrollbarVisibility("system", "win32")).toBe("show");
    expect(resolveHorizontalScrollbarVisibility("system", "linux")).toBe("show");
    expect(resolveHorizontalScrollbarVisibility("system", "darwin")).toBe("hide");
  });

  test("requires a supported platform for system horizontal scrollbar visibility", () => {
    expect(APP_PLATFORM_VALUES).toEqual(["win32", "linux", "darwin"]);
    expect(appPlatformSchema.parse("linux")).toBe("linux");
    expect(() => resolveHorizontalScrollbarVisibility("system")).toThrow(
      "A supported app platform is required to resolve System default horizontal scrollbar visibility.",
    );
    expect(() => resolveHorizontalScrollbarVisibility("system", "freebsd" as never)).toThrow(
      "Unsupported app platform for horizontal scrollbar visibility: freebsd",
    );
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
    expect(DEFAULT_AGENT_RUNTIMES.claude).toEqual({ enabled: false });
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
        commandNetworkAccess: true,
      },
      roleOverrides: {
        spec: { sandboxMode: "read-only", approvalPolicy: "untrusted" },
        planner: { approvalsReviewer: "user" },
        build: { sandboxMode: "workspace-write" },
        qa: { commandNetworkAccess: false },
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
        commandNetworkAccess: true,
      },
      roleOverrides: {
        qa: { sandboxMode: "workspace-write", commandNetworkAccess: true },
      },
    });

    expect(resolveCodexEffectivePolicy(config, "qa")).toEqual({
      sandboxMode: "workspace-write",
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      approvalsReviewerApplies: true,
      commandNetworkAccess: true,
    });
    expect(resolveCodexEffectivePolicy(config, "spec")).toEqual({
      sandboxMode: "read-only",
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      approvalsReviewerApplies: true,
      commandNetworkAccess: true,
    });
    expect(resolveCodexEffectivePolicy(config, "build")).toEqual({
      sandboxMode: "workspace-write",
      approvalPolicy: "untrusted",
      approvalsReviewer: "auto_review",
      approvalsReviewerApplies: true,
      commandNetworkAccess: true,
      adjustmentReason:
        "Build role requires workspace-write when sandboxMode is inherited from read-only.",
    });
  });

  test("resolves codex policy from defaults when no workflow role is supplied", () => {
    const config = codexRuntimeConfigSchema.parse({
      enabled: true,
      defaults: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
        commandNetworkAccess: true,
      },
      roleOverrides: {
        qa: { sandboxMode: "read-only", approvalsReviewer: "user" },
      },
    });

    expect(resolveCodexEffectivePolicy(config, null)).toEqual({
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
      approvalsReviewerApplies: true,
      commandNetworkAccess: true,
    });
  });

  test("allows dangerous explicit codex read-only role overrides", () => {
    const config = codexRuntimeConfigSchema.parse({
      enabled: true,
      roleOverrides: {
        spec: { approvalPolicy: "never" },
        qa: { sandboxMode: "danger-full-access" },
      },
    });

    expect(resolveCodexEffectivePolicy(config, "spec")).toMatchObject({
      approvalPolicy: "never",
      approvalsReviewerApplies: false,
    });
    expect(resolveCodexEffectivePolicy(config, "qa")).toMatchObject({
      sandboxMode: "danger-full-access",
      commandNetworkAccess: false,
    });
  });

  test("allows dangerous inherited codex policy for read-only roles", () => {
    const config = codexRuntimeConfigSchema.parse({
      enabled: true,
      defaults: {
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        approvalsReviewer: "user",
        commandNetworkAccess: false,
      },
    });

    expect(resolveCodexEffectivePolicy(config, "spec")).toMatchObject({
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
    });
    expect(resolveCodexEffectivePolicy(config, "planner")).toMatchObject({
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
      ...expectedDefaultChatSettings,
      showThinkingMessages: true,
    });
  });

  test("defaults file diff expansion for older chat settings", () => {
    const parsed = chatSettingsSchema.parse({ showThinkingMessages: false });

    expect(parsed).toEqual(expectedDefaultChatSettings);
  });

  test("defaults chat diff display settings for older chat settings", () => {
    const parsedSnapshot = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      chat: { showThinkingMessages: true },
      workspaces: {},
      globalPromptOverrides: {},
    });
    const parsedGlobalConfig = globalConfigSchema.parse({
      version: 2,
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(chatSettingsSchema.parse({})).toEqual(expectedDefaultChatSettings);
    expect(parsedSnapshot.chat).toEqual({
      ...expectedDefaultChatSettings,
      showThinkingMessages: true,
    });
    expect(parsedGlobalConfig.chat).toEqual(expectedDefaultChatSettings);
  });

  test("roundtrips explicit chat display settings", () => {
    const parsedSnapshot = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      chat: {
        showThinkingMessages: true,
        expandFileDiffsByDefault: false,
        diffStyle: "unified",
        diffIndicators: "classic",
        diffHeight: "scroll",
        lineOverflow: "scroll",
        hunkSeparators: "metadata",
      },
      workspaces: {},
      globalPromptOverrides: {},
    });
    const parsedGlobalConfig = globalConfigSchema.parse({
      version: 2,
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      chat: {
        showThinkingMessages: false,
        expandFileDiffsByDefault: false,
        diffStyle: "unified",
        diffIndicators: "none",
        diffHeight: "scroll",
        lineOverflow: "scroll",
        hunkSeparators: "simple",
      },
      workspaces: {},
      globalPromptOverrides: {},
    });

    expect(parsedSnapshot.chat).toEqual({
      showThinkingMessages: true,
      expandFileDiffsByDefault: false,
      diffStyle: "unified",
      diffIndicators: "classic",
      diffHeight: "scroll",
      lineOverflow: "scroll",
      hunkSeparators: "metadata",
    });
    expect(parsedGlobalConfig.chat).toEqual({
      showThinkingMessages: false,
      expandFileDiffsByDefault: false,
      diffStyle: "unified",
      diffIndicators: "none",
      diffHeight: "scroll",
      lineOverflow: "scroll",
      hunkSeparators: "simple",
    });
  });

  test("accepts every supported chat diff display value", () => {
    expect(DEFAULT_CHAT_SETTINGS).toEqual(expectedDefaultChatSettings);

    for (const diffStyle of CHAT_DIFF_STYLE_VALUES) {
      expect(chatSettingsSchema.parse({ diffStyle }).diffStyle).toBe(diffStyle);
    }
    for (const diffIndicators of CHAT_DIFF_INDICATOR_VALUES) {
      expect(chatSettingsSchema.parse({ diffIndicators }).diffIndicators).toBe(diffIndicators);
    }
    for (const diffHeight of CHAT_DIFF_HEIGHT_VALUES) {
      expect(chatSettingsSchema.parse({ diffHeight }).diffHeight).toBe(diffHeight);
    }
    for (const lineOverflow of CHAT_LINE_OVERFLOW_VALUES) {
      expect(chatSettingsSchema.parse({ lineOverflow }).lineOverflow).toBe(lineOverflow);
    }
    for (const hunkSeparators of CHAT_HUNK_SEPARATOR_VALUES) {
      expect(chatSettingsSchema.parse({ hunkSeparators }).hunkSeparators).toBe(hunkSeparators);
    }
  });

  test("rejects invalid explicit chat diff display values", () => {
    const invalidCases: Array<[string, Record<string, unknown>]> = [
      ["diffStyle", { diffStyle: "side-by-side" }],
      ["diffIndicators", { diffIndicators: "glyphs" }],
      ["diffHeight", { diffHeight: "auto" }],
      ["lineOverflow", { lineOverflow: "clip" }],
      ["hunkSeparators", { hunkSeparators: "custom" }],
    ];

    for (const [field, input] of invalidCases) {
      const result = chatSettingsSchema.safeParse(input);

      expect(result.success).toBe(false);
      if (result.success) {
        throw new Error(`Expected ${field} to reject invalid values`);
      }
      expect(result.error.issues.some((issue) => issue.path.includes(field))).toBe(true);
    }
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
        {
          id: " prompt-1 ",
          name: "summarize",
          description: "",
          content: "Body",
        },
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
      kanbanSettingsSchema.parse({
        doneVisibleDays: 1,
        emptyColumnDisplay: "compact",
      }),
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
      {
        eventId: "taskProgressedToHumanReview",
        actionIds: ["startGeneratePullRequest"],
      },
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
