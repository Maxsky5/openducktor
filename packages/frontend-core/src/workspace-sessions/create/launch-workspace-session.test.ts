import { expect, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionLaunchResult } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { createAgentSessionsStore } from "../../sessions/agent-sessions-store";
import { workspaceSessionQueryKeys } from "../../queries/workspace-sessions";
import { sessionMessagesToArray } from "../../test-support/session-message-test-helpers";
import {
  projectWorkspaceSessionResult,
  startWorkspaceSessionRuntime,
} from "./launch-workspace-session";

const createRecord = (): WorkspaceSession => ({
  id: "saved",
  runtimeKind: "codex",
  externalSessionId: "native",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  selectedModel: null,
  roleSnapshot: null,
  generatedTitle: null,
  manualTitle: "Old title",
  targetBranch: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

test.each([false, true])(
  "a delayed launch preserves metadata and native input with command receipt: %s",
  (command) => {
    const record = createRecord();
    const outcome: WorkspaceSessionLaunchResult = {
      workspaceId: "workspace",
      repoPath: "/repo",
      sessionId: "saved",
      status: "completed",
      record,
      session: {
        runtimeKind: "codex",
        externalSessionId: "native",
        workingDirectory: "/repo",
        startedAt: new Date(1000).toISOString(),
        status: "idle",
      },
    };
    if (command) outcome.acceptedMessage = { type: "command_accepted", commandName: "review" };
    const store = createAgentSessionsStore("/repo");
    const client = new QueryClient();
    const active = workspaceSessionQueryKeys.list("workspace", false);
    const archived = workspaceSessionQueryKeys.list("workspace", true);
    client.setQueryData(active, [record]);
    client.setQueryData(archived, []);
    projectWorkspaceSessionResult(outcome, store, client);
    expect(sessionMessagesToArray(store.getSessionSnapshot(outcome.session!)!)).toEqual([]);
    store.updateSession(outcome.session!, (session) => ({
      ...session,
      status: "running",
      pendingQuestions: [{ requestId: "new-question", questions: [] }],
    }));
    const newer = { ...record, manualTitle: "New title", archivedAt: 2000 };
    client.setQueryData(active, []);
    client.setQueryData(archived, [newer]);
    projectWorkspaceSessionResult(outcome, store, client);
    expect(client.getQueryData<WorkspaceSession[]>(active)).toEqual([]);
    expect(client.getQueryData<WorkspaceSession[]>(archived)).toEqual([newer]);
    expect(store.getSessionSnapshot(outcome.session!)).toMatchObject({
      title: "New title",
      status: "running",
      pendingQuestions: [{ requestId: "new-question" }],
    });
    client.clear();
  },
);

test("starts the runtime of a chat and shows its session at once", async () => {
  const record = createRecord();
  const requests: Array<{ workspaceId: string; sessionId: string }> = [];
  const store = createAgentSessionsStore("/repo");
  const client = new QueryClient();
  client.setQueryData(workspaceSessionQueryKeys.list("workspace", false), []);
  try {
    const result = await startWorkspaceSessionRuntime({
      host: {
        workspaceSessionStart: async (request) => {
          requests.push(request);
          return {
            session: record,
            runtimeSession: {
              runtimeKind: "codex",
              externalSessionId: "native",
              workingDirectory: "/repo",
              startedAt: new Date(1000).toISOString(),
              status: "idle",
            },
          };
        },
      },
      store,
      queryClient: client,
      workspace: { workspaceId: "workspace", repoPath: "/repo" },
      sessionId: "saved",
    });

    expect(requests).toEqual([{ workspaceId: "workspace", sessionId: "saved" }]);
    expect(result.session).toBe(record);
    expect(
      client.getQueryData<WorkspaceSession[]>(workspaceSessionQueryKeys.list("workspace", false)),
    ).toEqual([record]);
    expect(
      store.getSessionSnapshot({
        runtimeKind: "codex",
        externalSessionId: "native",
        workingDirectory: "/repo",
      }),
    ).toMatchObject({ title: "Old title" });
  } finally {
    client.clear();
  }
});
