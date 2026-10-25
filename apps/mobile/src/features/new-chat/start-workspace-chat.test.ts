import { afterEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceSession, WorkspaceSessionStartResult } from "@openducktor/contracts";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { workspaceSessionQueryKeys } from "@openducktor/frontend-core/queries/workspace-sessions";
import { createAgentSessionsStore } from "@openducktor/frontend-core/sessions/agent-sessions-store";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { workspaceSessionRecord } from "@openducktor/frontend-core/test-support/workspace-session-fixtures";
import { RemoteConnectionError } from "@openducktor/host-client/remote";
import { CHAT_START_WITHOUT_SESSION, startWorkspaceChat } from "./start-workspace-chat";

const WORKSPACE = { workspaceId: "workspace-1", repoPath: "/repos/alpha" };
const RUNTIME_SESSION = {
  externalSessionId: "native-started",
  runtimeKind: "codex" as const,
  workingDirectory: "/repos/alpha",
  startedAt: new Date(1_000).toISOString(),
  status: "idle" as const,
};

let connection: ClientConnection | null = null;

const start = (
  saved: WorkspaceSession,
  workspaceSessionStart: () => Promise<WorkspaceSessionStartResult>,
) => {
  connection = createTestClientConnection({ client: { workspaceSessionStart } });
  const { queryClient } = connection;
  queryClient.setQueryData(workspaceSessionQueryKeys.list(WORKSPACE.workspaceId, false), [saved]);
  const store = createAgentSessionsStore(WORKSPACE.repoPath);
  const started = startWorkspaceChat({
    host: { workspaceSessionStart },
    store,
    queryClient,
    workspace: WORKSPACE,
    record: saved,
  });
  return { started, queryClient };
};

afterEach(async () => {
  await connection?.dispose();
  connection = null;
});

describe("startWorkspaceChat", () => {
  test("opens the session that the started chat names", async () => {
    const saved = workspaceSessionRecord("chat", { externalSessionId: null });
    const { started } = start(saved, async () => ({
      session: { ...saved, externalSessionId: "native-started" },
      runtimeSession: RUNTIME_SESSION,
    }));
    expect(await started).toEqual({
      runtimeKind: "codex",
      externalSessionId: "native-started",
      workingDirectory: "/repos/alpha",
    });
  });

  test("opens the runtime session when the saved chat does not name it yet", async () => {
    const saved = workspaceSessionRecord("chat", { externalSessionId: null });
    const { started } = start(saved, async () => ({
      session: saved,
      runtimeSession: RUNTIME_SESSION,
    }));
    expect(await started).toEqual({
      runtimeKind: "codex",
      externalSessionId: "native-started",
      workingDirectory: "/repos/alpha",
    });
  });

  test("rejects a start without a session and tells the user to open the chat again", async () => {
    const saved = workspaceSessionRecord("chat", { externalSessionId: null });
    const { started } = start(saved, async () => ({ session: saved, runtimeSession: null }));
    await expect(started).rejects.toThrow(CHAT_START_WITHOUT_SESSION);
  });

  test("reads the chat list again after a lost result, and does not start again", async () => {
    const saved = workspaceSessionRecord("chat", { externalSessionId: null });
    const workspaceSessionStart = mock(async (): Promise<WorkspaceSessionStartResult> => {
      throw new RemoteConnectionError({
        code: "outcome_unknown",
        message: "The result of workspace_session_start was lost.",
        nextAction: "Read current host state to check the outcome.",
      });
    });
    const { started, queryClient } = start(saved, workspaceSessionStart);
    const listKey = workspaceSessionQueryKeys.list(WORKSPACE.workspaceId, false);
    await expect(started).rejects.toBeInstanceOf(RemoteConnectionError);
    expect(queryClient.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(workspaceSessionStart).toHaveBeenCalledTimes(1);
  });

  test("keeps the chat list after a refused start", async () => {
    const saved = workspaceSessionRecord("chat", { externalSessionId: null });
    const { started, queryClient } = start(saved, async () => {
      throw new Error("The runtime is disabled.");
    });
    await expect(started).rejects.toThrow("The runtime is disabled.");
    expect(
      queryClient.getQueryState(workspaceSessionQueryKeys.list(WORKSPACE.workspaceId, false))
        ?.isInvalidated,
    ).toBe(false);
  });
});
