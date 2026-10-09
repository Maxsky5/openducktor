import { expect, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionLaunchSnapshot } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { workspaceSessionQueryKeys } from "@/state/queries/workspace-sessions";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { launchWorkspaceSession, projectWorkspaceSessionLaunch } from "./launch-workspace-session";

const createRecord = (): WorkspaceSession => ({
  id: "saved",
  runtimeKind: "codex",
  externalSessionId: "native",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  selectedModel: null,
  roleSnapshot: null,
  generatedTitle: null,
  manualTitle: "Old title",
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

test.each(["codex", "opencode", "claude"] as const)(
  "a %s workspace launch publishes running without an idle step",
  (runtimeKind) => {
    const record = { ...createRecord(), runtimeKind };
    const session = {
      runtimeKind,
      externalSessionId: "native",
      workingDirectory: "/repo",
      startedAt: new Date(1000).toISOString(),
      status: "idle" as const,
    };
    const store = createAgentSessionsStore("/repo");
    const client = new QueryClient();
    const statuses: string[] = [];
    store.subscribe(() => {
      const current = store.getSessionSnapshot(session);
      if (current) statuses.push(current.status);
    });
    projectWorkspaceSessionLaunch(
      {
        launchAttemptId: "attempt",
        workspaceId: "workspace",
        repoPath: "/repo",
        sessionId: record.id,
        phase: "completed",
        acceptance: "accepted",
        ownershipSaved: true,
        record,
        session,
        liveSession: {
          ref: { ...session, repoPath: "/repo" },
          activity: "running",
          title: "Native session",
          startedAt: session.startedAt,
          contextUsage: null,
          pendingApprovals: [],
          pendingQuestions: [],
        },
      },
      store,
      client,
    );
    expect(statuses).toEqual(["running"]);
    client.clear();
  },
);

test("a delayed launch preserves newer workspace metadata and native input", () => {
  const record = createRecord();
  const outcome: WorkspaceSessionLaunchSnapshot = {
    launchAttemptId: "attempt",
    workspaceId: "workspace",
    repoPath: "/repo",
    sessionId: "saved",
    phase: "completed",
    acceptance: "accepted",
    ownershipSaved: true,
    record,
    session: {
      runtimeKind: "codex",
      externalSessionId: "native",
      workingDirectory: "/repo",
      startedAt: new Date(1000).toISOString(),
      status: "idle",
    },
    liveSession: {
      ref: {
        runtimeKind: "codex",
        externalSessionId: "native",
        workingDirectory: "/repo",
        repoPath: "/repo",
      },
      startedAt: new Date(1000).toISOString(),
      title: "Old title",
      activity: "idle",
      contextUsage: null,
      pendingQuestions: [],
      pendingApprovals: [],
    },
  };
  const store = createAgentSessionsStore("/repo");
  const client = new QueryClient();
  const active = workspaceSessionQueryKeys.list("workspace", false);
  const archived = workspaceSessionQueryKeys.list("workspace", true);
  client.setQueryData(active, [record]);
  client.setQueryData(archived, []);
  projectWorkspaceSessionLaunch(outcome, store, client);
  store.updateSession(outcome.session!, (session) => ({
    ...session,
    status: "running",
    pendingQuestions: [{ requestId: "new-question", questions: [] }],
  }));
  const newer = { ...record, manualTitle: "New title", archivedAt: 2000 };
  client.setQueryData(active, []);
  client.setQueryData(archived, [newer]);
  projectWorkspaceSessionLaunch(outcome, store, client);
  expect(client.getQueryData<WorkspaceSession[]>(active)).toEqual([]);
  expect(client.getQueryData<WorkspaceSession[]>(archived)).toEqual([newer]);
  expect(store.getSessionSnapshot(outcome.session!)).toMatchObject({
    title: "New title",
    status: "running",
    pendingQuestions: [{ requestId: "new-question" }],
  });
  client.clear();
});

test.each(["record", "runtime", "directory", "execution-kind"] as const)(
  "rejects a mismatched launch %s before registering a chat",
  async (field) => {
    const record = createRecord();
    const returned = createRecord();
    if (field === "record") returned.id = "other-chat";
    if (field === "runtime") returned.runtimeKind = "opencode";
    if (field === "directory") returned.executionTarget.workingDirectory = "/other";
    if (field === "execution-kind")
      returned.executionTarget = {
        kind: "local_worktree",
        workingDirectory: "/repo",
        branchName: "test-branch",
        worktreeState: "present",
      };
    const store = createAgentSessionsStore("/repo");
    const client = new QueryClient();
    configureShellBridge(
      createShellBridgeFixture({
        client: {
          workspaceSessionLaunch: async (request) => ({
            ...request,
            phase: "completed",
            acceptance: "accepted",
            ownershipSaved: true,
            record: returned,
          }),
        },
      }),
    );
    try {
      await expect(
        launchWorkspaceSession(
          {
            launchAttemptId: "attempt",
            workspaceId: "workspace",
            repoPath: "/repo",
            sessionId: record.id,
            parts: [{ kind: "text", text: "Hello" }],
          },
          record,
          store,
          client,
        ),
      ).rejects.toThrow("different chat target");
      expect(store.listSessionSnapshots()).toEqual([]);
      expect(
        client.getQueryData(workspaceSessionQueryKeys.list("workspace", false)),
      ).toBeUndefined();
    } finally {
      client.clear();
      configureShellBridge(createUnavailableShellBridge());
    }
  },
);
