import { expect, test } from "bun:test";
import {
  applyCustomAgentRoleEdits,
  applyGlobalSettingsPatch,
  applyWorkspaceSettingsPatch,
  diffSettingsSnapshot,
  globalConfigSchema,
  promptOverrideKey,
  repoConfigSchema,
  ROLE_INSTRUCTIONS_PROMPT_ID,
  retainSettingsSnapshotUpdateTargets,
} from "@openducktor/contracts";
import {
  createRepoSettingsConfigFixture,
  createSettingsSnapshotFixture,
} from "@/test-utils/shared-test-fixtures";
import { rebaseSettingsDraft } from "./settings-draft-rebase";

const rolePrompt = (roleId: string) =>
  promptOverrideKey({ ownerKind: "role", ownerId: roleId, promptId: ROLE_INSTRUCTIONS_PROMPT_ID });
const REMOVED_PROMPT = rolePrompt("removed");
const CLEAN_PROMPT = rolePrompt("clean");
const CURRENT_PROMPT = rolePrompt("current");
const LOCAL_PROMPT = rolePrompt("local");

test("keeps edits of a removed workspace by ID while refreshing saved fields", () => {
  const baseline = createSettingsSnapshotFixture({
    workspaces: {
      removed: createRepoSettingsConfigFixture("removed", "/repos/shared"),
      clean: createRepoSettingsConfigFixture("clean", "/repos/clean"),
      current: createRepoSettingsConfigFixture("current", "/repos/current"),
    },
  });
  const draft = structuredClone(baseline);
  draft.workspaces.removed!.workspaceName = "";
  draft.workspaces.removed!.branchPrefix = "UNSAVED";
  draft.workspaces.current!.branchPrefix = "local";
  const fresh = createSettingsSnapshotFixture({
    appearance: { horizontalScrollbarVisibility: "hide" },
    workspaces: {
      replacement: createRepoSettingsConfigFixture("replacement", "/repos/shared"),
      current: {
        ...baseline.workspaces.current!,
        workspaceName: "Foreign name",
        branchPrefix: "foreign",
      },
    },
  });

  const rebased = rebaseSettingsDraft(baseline, draft, fresh);

  expect(rebased.workspaces.removed).toMatchObject({
    workspaceId: "removed",
    repoPath: "/repos/shared",
    workspaceName: "",
    branchPrefix: "UNSAVED",
  });
  expect(rebased.workspaces.clean).toBeUndefined();
  expect(rebased.workspaces.replacement).toEqual(fresh.workspaces.replacement);
  expect(rebased.workspaces.current).toMatchObject({
    workspaceName: "Foreign name",
    branchPrefix: "local",
  });
  expect(rebased.appearance.horizontalScrollbarVisibility).toBe("hide");

  const refreshedAgain = rebaseSettingsDraft(fresh, rebased, {
    ...fresh,
    theme: "dark",
  });
  expect(refreshedAgain.workspaces.removed?.branchPrefix).toBe("UNSAVED");
  expect(refreshedAgain.theme).toBe("dark");
});

test("keeps update intent for edited removed records across refreshes", () => {
  const removedRole = { id: "removed", name: "Removed", systemPrompt: "Original prompt" };
  const currentRole = { id: "current", name: "Current", systemPrompt: "Current prompt" };
  const localRole = { id: "local", name: "Local", systemPrompt: "New role" };
  const baseline = createSettingsSnapshotFixture({
    customAgentRoles: [
      removedRole,
      { id: "clean", name: "Clean", systemPrompt: "Clean prompt" },
      currentRole,
    ],
    workspaces: {
      removed: createRepoSettingsConfigFixture("removed", "/repos/removed"),
      clean: createRepoSettingsConfigFixture("clean", "/repos/clean"),
      current: createRepoSettingsConfigFixture("current", "/repos/current"),
    },
  });
  const draft = structuredClone(baseline);
  draft.customAgentRoles = [
    { ...removedRole, systemPrompt: "Unsaved removed prompt" },
    draft.customAgentRoles[1]!,
    { ...currentRole, systemPrompt: "Unsaved current prompt" },
    localRole,
  ];
  draft.workspaces.removed!.branchPrefix = "unsaved-removed";
  draft.workspaces.current!.branchPrefix = "unsaved-current";
  const fresh = createSettingsSnapshotFixture({
    theme: "dark",
    customAgentRoles: [{ ...currentRole, name: "Foreign role name" }],
    workspaces: {
      current: { ...baseline.workspaces.current!, workspaceName: "Foreign workspace name" },
    },
  });

  const rebased = rebaseSettingsDraft(baseline, draft, fresh);
  const editBaseline = retainSettingsSnapshotUpdateTargets(baseline, draft, fresh);
  const edits = diffSettingsSnapshot(editBaseline, rebased);

  expect(edits.customAgentRoles).toEqual({
    update: {
      current: { systemPrompt: "Unsaved current prompt" },
      removed: { systemPrompt: "Unsaved removed prompt" },
    },
    create: [localRole],
  });
  expect(edits.workspaces).toEqual({
    removed: { expectedRepoPath: "/repos/removed", branchPrefix: "unsaved-removed" },
    current: { expectedRepoPath: "/repos/current", branchPrefix: "unsaved-current" },
  });
  expect(edits.global).toBeUndefined();
  expect(editBaseline).toEqual({
    ...fresh,
    customAgentRoles: [...fresh.customAgentRoles, removedRole],
    workspaces: { ...fresh.workspaces, removed: baseline.workspaces.removed! },
  });
  expect(() =>
    applyCustomAgentRoleEdits(fresh.customAgentRoles, edits.customAgentRoles, "request"),
  ).toThrow("Settings record removed no longer exists");

  expect(
    diffSettingsSnapshot(
      retainSettingsSnapshotUpdateTargets(editBaseline, rebased, fresh),
      rebaseSettingsDraft(editBaseline, rebased, fresh),
    ),
  ).toEqual(edits);
});

test("does not recreate edited nested records removed by a refresh", () => {
  const prompt = { template: "Original prompt", baseVersion: 1 };
  const model = { runtimeKind: "codex" as const, providerId: "openai", modelId: "original" };
  const baseline = createSettingsSnapshotFixture({
    globalPromptOverrides: {
      [REMOVED_PROMPT]: { ...prompt },
      [CLEAN_PROMPT]: { ...prompt },
      [CURRENT_PROMPT]: { ...prompt },
    },
    workspaces: {
      current: {
        ...createRepoSettingsConfigFixture("current", "/repos/current"),
        promptOverrides: { [REMOVED_PROMPT]: { ...prompt } },
        agentDefaults: { removed: model },
      },
    },
  });
  baseline.agentRuntimes.codex.roleOverrides = { removed: { sandboxMode: "read-only" } };
  baseline.agentRuntimes.claude.roleOverrides = { removed: { permissionMode: "default" } };
  baseline.agentRuntimes.opencode.roleOverrides = { removed: { rules: [] } };
  const draft = structuredClone(baseline);
  draft.globalPromptOverrides[REMOVED_PROMPT]!.template = "Unsaved prompt";
  draft.globalPromptOverrides[CURRENT_PROMPT]!.template = "Unsaved current prompt";
  draft.globalPromptOverrides[LOCAL_PROMPT] = { ...prompt, template: "New prompt" };
  draft.agentRuntimes.codex.roleOverrides.removed!.sandboxMode = "workspace-write";
  draft.agentRuntimes.claude.roleOverrides.removed!.permissionMode = "acceptEdits";
  draft.agentRuntimes.opencode.roleOverrides.removed!.rules = [
    { permission: "edit", pattern: "*", action: "allow" },
  ];
  draft.workspaces.current!.promptOverrides[REMOVED_PROMPT]!.template = "Unsaved workspace prompt";
  draft.workspaces.current!.agentDefaults.removed!.modelId = "unsaved-model";
  const fresh = structuredClone(baseline);
  fresh.theme = "dark";
  fresh.globalPromptOverrides = {
    [CURRENT_PROMPT]: { template: "Foreign prompt", baseVersion: 2 },
  };
  fresh.agentRuntimes.codex.roleOverrides = {};
  fresh.agentRuntimes.claude.roleOverrides = {};
  fresh.agentRuntimes.opencode.roleOverrides = {};
  fresh.workspaces.current!.promptOverrides = {};
  fresh.workspaces.current!.agentDefaults = {};
  const originalEdits = {
    create: { [LOCAL_PROMPT]: { template: "New prompt", baseVersion: 1 } },
    update: {
      [REMOVED_PROMPT]: { template: "Unsaved prompt" },
      [CURRENT_PROMPT]: { template: "Unsaved current prompt" },
    },
  };
  expect(diffSettingsSnapshot(baseline, draft).global?.globalPromptOverrides).toEqual(
    originalEdits,
  );

  const rebased = rebaseSettingsDraft(baseline, draft, fresh);
  const editBaseline = retainSettingsSnapshotUpdateTargets(baseline, draft, fresh);
  const edits = diffSettingsSnapshot(editBaseline, rebased);

  expect(edits.global?.globalPromptOverrides).toEqual(originalEdits);
  expect(edits.global?.agentRuntimes).toEqual({
    codex: {
      roleOverrides: {
        update: { removed: { sandboxMode: { type: "set", value: "workspace-write" } } },
      },
    },
    claude: {
      roleOverrides: {
        update: { removed: { permissionMode: { type: "set", value: "acceptEdits" } } },
      },
    },
    opencode: {
      roleOverrides: {
        update: { removed: { rules: [{ permission: "edit", pattern: "*", action: "allow" }] } },
      },
    },
  });
  expect(edits.workspaces).toEqual({
    current: {
      expectedRepoPath: "/repos/current",
      promptOverrides: { update: { [REMOVED_PROMPT]: { template: "Unsaved workspace prompt" } } },
      agentDefaults: { update: { removed: { modelId: "unsaved-model" } } },
    },
  });
  for (const [global, record] of [
    [{ globalPromptOverrides: edits.global?.globalPromptOverrides }, REMOVED_PROMPT],
    [{ agentRuntimes: { codex: edits.global?.agentRuntimes?.codex } }, "removed"],
    [{ agentRuntimes: { claude: edits.global?.agentRuntimes?.claude } }, "removed"],
    [{ agentRuntimes: { opencode: edits.global?.agentRuntimes?.opencode } }, "removed"],
  ] as const)
    expect(() =>
      applyGlobalSettingsPatch(
        globalConfigSchema.parse({ ...fresh, version: 4 }),
        global,
        "request",
      ),
    ).toThrow(`Settings record ${record} no longer exists`);
  for (const [fields, record] of [
    [{ promptOverrides: edits.workspaces?.current?.promptOverrides }, REMOVED_PROMPT],
    [{ agentDefaults: edits.workspaces?.current?.agentDefaults }, "removed"],
  ] as const)
    expect(() =>
      applyWorkspaceSettingsPatch(repoConfigSchema.parse(fresh.workspaces.current), {
        expectedRepoPath: "/repos/current",
        ...fields,
      }),
    ).toThrow(`Settings record ${record} no longer exists`);
  expect(rebased.globalPromptOverrides[CURRENT_PROMPT]).toEqual({
    template: "Unsaved current prompt",
    baseVersion: 2,
  });
  expect(rebased.globalPromptOverrides[CLEAN_PROMPT]).toBeUndefined();
  expect(editBaseline.globalPromptOverrides[CLEAN_PROMPT]).toBeUndefined();
  expect(rebased.theme).toBe("dark");
  expect(
    diffSettingsSnapshot(
      retainSettingsSnapshotUpdateTargets(editBaseline, rebased, fresh),
      rebaseSettingsDraft(editBaseline, rebased, fresh),
    ),
  ).toEqual(edits);
});

test("keeps saved custom role order when a clean snapshot refreshes", () => {
  const baseline = createSettingsSnapshotFixture({
    customAgentRoles: [
      { id: "2", name: "Second", systemPrompt: "Second prompt" },
      { id: "1", name: "First", systemPrompt: "First prompt" },
    ],
  });
  const fresh = { ...baseline, theme: "dark" as const };

  expect(retainSettingsSnapshotUpdateTargets(baseline, structuredClone(baseline), fresh)).toEqual(
    fresh,
  );
});
