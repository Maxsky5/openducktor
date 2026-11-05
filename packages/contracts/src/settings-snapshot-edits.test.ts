import { describe, expect, test } from "bun:test";
import {
  globalConfigSchema,
  globalSettingsPatchSchema,
  settingsSnapshotSchema,
  workspaceSettingsPatchSchema,
} from "./config-schemas";
import { promptOverrideKey, ROLE_INSTRUCTIONS_PROMPT_ID } from "./prompt-schemas";
import { systemOpenInToolIdSchema } from "./system-open-schemas";
import {
  applyCustomAgentRoleEdits,
  applyGlobalSettingsPatch,
  applySettingsSnapshotPatch,
  diffSettingsSnapshot,
} from "./settings-snapshot-edits";

describe("settings snapshot edits", () => {
  test("round-trips a change of every editable field through diff and apply", () => {
    const before = settingsSnapshotSchema.parse({
      theme: "light",
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          abbreviation: "RE",
          worktreeBasePath: "/worktrees",
        },
      },
    });
    const after = structuredClone(before);
    after.system = { preferredOpenInToolId: systemOpenInToolIdSchema.options[0] };
    after.git.defaultMergeMethod = "squash";
    after.general.openAgentStudioTabOnBackgroundSessionStart = false;
    after.appearance.horizontalScrollbarVisibility = "hide";
    after.chat.showThinkingMessages = true;
    after.reusablePrompts = [{ id: "review", name: "Review", description: "", content: "Check" }];
    after.kanban.doneVisibleDays = 3;
    after.notifications.volumePercent = 50;
    after.agentRuntimes.opencode.executablePath = "/bin/opencode";
    after.globalPromptOverrides = {
      [promptOverrideKey({
        ownerKind: "workflow",
        ownerId: "rpi",
        promptId: "messages.spec_start",
      })]: { template: "Spec", baseVersion: 1, enabled: true },
    };
    after.customAgentRoles = [{ id: "reviewer", name: "Reviewer", systemPrompt: "Review" }];
    after.autopilot = {
      alwaysStartQaReviewsFresh: true,
      rules: [
        {
          workflowId: "openducktor-spec-plan-build",
          eventId: "taskRejectedByQa",
          actionIds: ["build"],
        },
      ],
    };
    const model = { runtimeKind: "opencode" as const, providerId: "openai", modelId: "gpt-5" };
    after.workspaces.repo = {
      workspaceId: "repo",
      workspaceName: "Renamed",
      repoPath: "/moved",
      tileColor: "#f08c00",
      defaultModel: model,
      branchPrefix: "feature",
      defaultTargetBranch: { remote: "upstream", branch: "develop" },
      git: { provider: { id: "github", enabled: true, autoDetected: false } },
      hooks: { postComplete: ["bun test"] },
      actions: {
        items: [
          {
            id: "dev",
            icon: "play",
            name: "Dev",
            command: "bun run dev",
            runOnWorktreeCreate: false,
            waitBeforeAgentStart: false,
          },
        ],
        defaultActionId: "dev",
      },
      worktreeCopyPaths: [".env"],
      promptOverrides: {
        [promptOverrideKey({
          ownerKind: "role",
          ownerId: "qa",
          promptId: ROLE_INSTRUCTIONS_PROMPT_ID,
        })]: { template: "QA", baseVersion: 2, enabled: false },
      },
      agentDefaults: { build: model },
    };

    const edits = diffSettingsSnapshot(before, after);

    // A patch field without an edit rule is missing here, so this check fails for it.
    expect(Object.keys(edits.global ?? {}).toSorted()).toEqual(
      Object.keys(globalSettingsPatchSchema.shape).toSorted(),
    );
    expect(Object.keys(edits.workspaces?.repo ?? {}).toSorted()).toEqual(
      Object.keys(workspaceSettingsPatchSchema.shape).toSorted(),
    );
    expect(edits.workspaces?.repo).toMatchObject({
      abbreviation: { type: "clear" },
      worktreeBasePath: { type: "clear" },
    });
    expect(applySettingsSnapshotPatch(before, edits, { preferences: true })).toEqual(
      settingsSnapshotSchema.parse(after),
    );
  });

  test("merges optional object leaves into newer settings and replaces arrays and records", () => {
    const before = settingsSnapshotSchema.parse({
      theme: "light",
      agentRuntimes: {
        claude: {
          enabled: true,
          executablePath: "claude",
          defaults: {
            toolAvailability: { Read: true, Edit: false },
            permissions: { allow: ["Read"], deny: ["Bash"] },
            sandbox: { filesystem: { allowWrite: ["/old"], denyRead: ["/secret"] } },
          },
        },
      },
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          defaultModel: {
            runtimeKind: "claude",
            providerId: "anthropic",
            modelId: "old",
            variant: "fast",
          },
        },
      },
    });
    const after = structuredClone(before);
    after.agentRuntimes.claude.defaults.toolAvailability = { Read: false };
    after.agentRuntimes.claude.defaults.permissions!.allow = [];
    after.agentRuntimes.claude.defaults.sandbox!.filesystem!.allowWrite = ["/new"];
    after.agentRuntimes.claude.defaults.sandbox!.network = {};
    delete after.workspaces.repo!.defaultModel!.variant;
    const edits = diffSettingsSnapshot(before, after);
    expect(edits.global?.agentRuntimes?.claude?.defaults).toEqual({
      toolAvailability: { type: "set", value: { Read: false } },
      permissions: { type: "set", value: { allow: { type: "set", value: [] } } },
      sandbox: {
        type: "set",
        value: {
          filesystem: { type: "set", value: { allowWrite: { type: "set", value: ["/new"] } } },
          network: { type: "set", value: {} },
        },
      },
    });
    const current = structuredClone(before);
    current.agentRuntimes.claude.defaults.permissions!.deny = ["Edit"];
    current.agentRuntimes.claude.defaults.sandbox!.filesystem!.denyRead = ["/private"];
    current.workspaces.repo!.defaultModel!.modelId = "newer";
    const unchanged = structuredClone(current);
    const saved = applySettingsSnapshotPatch(current, edits, { preferences: true });
    expect(saved.agentRuntimes.claude.defaults).toEqual({
      toolAvailability: { Read: false },
      permissions: { allow: [], deny: ["Edit"] },
      sandbox: { filesystem: { allowWrite: ["/new"], denyRead: ["/private"] }, network: {} },
    });
    expect(saved.workspaces.repo!.defaultModel).toEqual({
      runtimeKind: "claude",
      providerId: "anthropic",
      modelId: "newer",
    });
    expect(current).toEqual(unchanged);
  });

  test("acknowledges keyed races while requests reject them and both reject overlapping edits", () => {
    const role = { id: "existing", name: "Existing", systemPrompt: "Current" };
    const edits = {
      create: [
        { ...role, systemPrompt: "Submitted" },
        { ...role, id: "new", name: "New" },
      ],
      update: { removed: { name: "Renamed" } },
      remove: ["gone"],
    };
    expect(() => applyCustomAgentRoleEdits([role], edits, "request")).toThrow("already exists");
    expect(() => applyCustomAgentRoleEdits([role], { update: edits.update }, "request")).toThrow(
      "no longer exists",
    );
    expect(applyCustomAgentRoleEdits([role], edits, "acknowledged")).toEqual([
      role,
      { ...role, id: "new", name: "New" },
    ]);
    for (const application of ["request", "acknowledged"] as const) {
      expect(() =>
        applyCustomAgentRoleEdits(
          [role],
          {
            update: { existing: { name: "Renamed" } },
            remove: ["existing"],
          },
          application,
        ),
      ).toThrow("more than one edit");
      expect(() => applyCustomAgentRoleEdits([], { create: [role, role] }, application)).toThrow(
        "IDs must be unique",
      );
    }
  });

  test.each(["extra", "constructor"])(
    "edits configured runtime %s without changing runtime definitions",
    (runtimeKind) => {
      const before = settingsSnapshotSchema.parse({
        theme: "light",
        agentRuntimes: {
          [runtimeKind]: { enabled: false, executablePath: "old" },
          removed: { enabled: false, executablePath: "removed" },
        },
      });
      const after = structuredClone(before);
      after.agentRuntimes[runtimeKind] = { enabled: true, executablePath: "new" };
      after.agentRuntimes.added = { enabled: true, executablePath: "added" };
      delete after.agentRuntimes.removed;
      const edits = diffSettingsSnapshot(before, after);
      expect(edits).toEqual({
        global: {
          agentRuntimes: { [runtimeKind]: { enabled: true, executablePath: "new" } },
        },
      });
      expect(
        applySettingsSnapshotPatch(before, edits, { preferences: true }).agentRuntimes[runtimeKind],
      ).toEqual({ enabled: true, executablePath: "new" });
    },
  );

  test("rejects edits for missing runtimes in requests and acknowledgments", () => {
    const missing = globalConfigSchema.parse({ version: 4 });
    for (const application of ["request", "acknowledged"] as const)
      expect(() =>
        applyGlobalSettingsPatch(
          missing,
          { agentRuntimes: { extra: { enabled: true } } },
          application,
        ),
      ).toThrow("Runtime extra is no longer configured");
  });
});
