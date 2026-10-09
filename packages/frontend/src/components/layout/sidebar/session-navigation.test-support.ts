import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import type { AgentRole, RuntimeKind } from "@openducktor/contracts";
import {
  type SessionNavigationTarget,
  sessionNavigationTargetKey,
} from "@/features/session-navigation/session-navigation-target";
import type {
  SessionNavigationEntry,
  SessionNavigationGroupId,
  SessionNavigationModel,
  SessionNavigationWorkspace,
} from "@/state/read-models/session-navigation-read-model";

export const NOW = Date.parse("2026-09-30T12:00:00.000Z");

export const alphaWorkspace: SessionNavigationWorkspace = {
  workspaceId: "alpha",
  workspaceName: "openducktor",
  repoPath: "/repos/alpha",
  abbreviation: "OP",
  tileColor: "#7c3aed",
  iconDataUrl: null,
};

export const betaWorkspace: SessionNavigationWorkspace = {
  workspaceId: "beta",
  workspaceName: "fairnest",
  repoPath: "/repos/beta",
  abbreviation: null,
  tileColor: null,
  iconDataUrl: null,
};

type EntryOverrides = Partial<Omit<SessionNavigationEntry, "key" | "target">>;

const entryFor = (
  target: SessionNavigationTarget,
  workspace: SessionNavigationWorkspace,
  entry: Omit<SessionNavigationEntry, "key" | "target" | "workspace">,
): SessionNavigationEntry => ({
  key: sessionNavigationTargetKey(target),
  target,
  workspace,
  ...entry,
});

export const taskSessionEntry = (
  externalSessionId: string,
  {
    role = "build",
    runtimeKind = "codex",
    taskId = `task-${externalSessionId}`,
    ...overrides
  }: EntryOverrides & {
    role?: AgentRole;
    runtimeKind?: RuntimeKind;
    taskId?: string;
  } = {},
): SessionNavigationEntry => {
  const workspace = overrides.workspace ?? alphaWorkspace;
  return entryFor(
    {
      kind: "task_session",
      workspaceId: workspace.workspaceId,
      taskId,
      role,
      identity: { externalSessionId, runtimeKind, workingDirectory: "/repos/alpha" },
    },
    workspace,
    {
      context: {
        kind: "task",
        task: createTaskCardFixture({
          id: taskId,
          title: `Task ${externalSessionId}`,
        }),
        sessions: [
          {
            externalSessionId,
            role,
            runtimeKind,
            workingDirectory: "/repos/alpha",
            startedAt: new Date(NOW - 3600000).toISOString(),
            selectedModel: null,
          },
        ],
      },
      title: `Task ${externalSessionId}`,
      runtimeKind,
      workflowTone: "available",
      attention: [],
      status: { kind: "settled", failed: false },
      time: { kind: "activity", at: NOW - 6 * 60_000 },
      fault: null,
      ...overrides,
    },
  );
};

export const workspaceSessionEntry = (
  sessionId: string,
  overrides: EntryOverrides = {},
): SessionNavigationEntry => {
  const workspace = overrides.workspace ?? alphaWorkspace;
  return entryFor(
    { kind: "workspace_session", workspaceId: workspace.workspaceId, sessionId },
    workspace,
    {
      context: {
        kind: "workspace",
        session: {
          id: sessionId,
          externalSessionId: sessionId,
          runtimeKind: "codex",
          executionTarget: { kind: "local_repo_root", workingDirectory: workspace.repoPath },
          roleSnapshot: null,
          selectedModel: null,
          generatedTitle: null,
          manualTitle: `Chat ${sessionId}`,
          createdAt: NOW - 3600000,
          updatedAt: NOW - 28 * 60000,
          speed: "standard",
          archivedAt: null,
        },
      },
      title: `Chat ${sessionId}`,
      runtimeKind: "codex",
      workflowTone: null,
      attention: [],
      status: { kind: "settled", failed: false },
      time: { kind: "activity", at: NOW - 28 * 60_000 },
      fault: null,
      ...overrides,
    },
  );
};

export const blockedTaskEntry = (taskId: string): SessionNavigationEntry =>
  entryFor(
    { kind: "task", workspaceId: alphaWorkspace.workspaceId, taskId, role: null },
    alphaWorkspace,
    {
      context: {
        kind: "task",
        task: createTaskCardFixture({ id: taskId, status: "blocked" }),
        sessions: [],
      },
      title: `Blocked ${taskId}`,
      runtimeKind: null,
      workflowTone: null,
      attention: ["blocked"],
      status: { kind: "settled", failed: false },
      time: { kind: "none" },
      fault: null,
    },
  );

export const navigationModel = (
  groups: Partial<Record<SessionNavigationGroupId, SessionNavigationEntry[]>>,
  overrides: Partial<SessionNavigationModel> = {},
): SessionNavigationModel => {
  const orderedGroups = (["needs_you", "running", "recent"] as const).map((id) => ({
    id,
    entries: groups[id] ?? [],
  }));
  return {
    groups: orderedGroups,
    entryCount: orderedGroups.reduce((count, group) => count + group.entries.length, 0),
    isLoading: false,
    issues: [],
    taskBlocks: [],
    ...overrides,
  };
};
