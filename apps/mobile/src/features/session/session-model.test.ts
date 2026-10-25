import { describe, expect, test } from "bun:test";
import type { WorkspaceSession } from "@openducktor/contracts";
import {
  createAgentSessionFixture,
  createWorkspaceRecordFixture,
} from "@openducktor/frontend-core/test-support/shared-test-fixtures";
import type { AgentSessionReadModelLoadState } from "@openducktor/frontend-core/types/agent-session-read-model";
import {
  resolveSessionInteraction,
  type SessionInteractionInput,
} from "./session-interaction-model";
import { resolveSessionOwner, workOwnerParamsFor, type RecordsRead } from "./session-owner-model";
import { readSessionRoute, readSessionRouteTitle } from "./session-route";
import type { SessionTarget } from "./session-target";
import { deriveLiveTranscriptState, mergePendingCounts } from "./session-transcript-state";
import { visibleSessionTargetFor } from "./session-visible-target";

const identity = {
  externalSessionId: "ext-1",
  runtimeKind: "opencode" as const,
  workingDirectory: "/repo",
};

const chatRecord = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: "chat-1",
  runtimeKind: "opencode",
  externalSessionId: "ext-1",
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: "Fix the login form",
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  targetBranch: null,
  ...overrides,
});

const records = (
  data: WorkspaceSession[] | undefined,
  extra: Partial<RecordsRead> = {},
): RecordsRead => ({
  data,
  error: null,
  isPending: data === undefined,
  ...extra,
});

const READY: AgentSessionReadModelLoadState = { kind: "ready", workspaceRepoPath: "/repo" };
const LOADING: AgentSessionReadModelLoadState = { kind: "loading", workspaceRepoPath: "/repo" };

describe("readSessionRoute", () => {
  test("reads the identity and the view flags", () => {
    const result = readSessionRoute({
      workspaceId: "ws-1",
      externalSessionId: "ext-1",
      runtimeKind: "opencode",
      workingDirectory: "/repo",
      readOnly: "1",
      focus: "pending-input",
    });
    expect(result).toEqual({
      ok: true,
      route: { workspaceId: "ws-1", identity, readOnly: true, focusPendingInput: true },
    });
  });

  test("rejects a link without the full identity", () => {
    const result = readSessionRoute({ workspaceId: "ws-1", externalSessionId: "ext-1" });
    expect(result.ok).toBe(false);
  });

  test("names a runtime that the app does not know", () => {
    const result = readSessionRoute({
      workspaceId: "ws-1",
      externalSessionId: "ext-1",
      runtimeKind: "future-runtime",
      workingDirectory: "/repo",
    });
    expect(result).toEqual({
      ok: false,
      message:
        'This app does not know the runtime "future-runtime". Update the app, then open the session again.',
    });
  });
});

describe("readSessionRouteTitle", () => {
  test("reads the title that the opening row passed for the first frame", () => {
    expect(readSessionRouteTitle({ params: { title: "Fix login", task: "1" } })).toEqual({
      title: "Fix login",
      task: true,
    });
    expect(readSessionRouteTitle({ params: { title: "Chat about tests" } })).toEqual({
      title: "Chat about tests",
      task: false,
    });
  });

  test("shows no title for a link without one, instead of the route name", () => {
    expect(readSessionRouteTitle({ params: { workspaceId: "ws-1" } })).toEqual({
      title: "",
      task: false,
    });
    expect(readSessionRouteTitle({})).toEqual({ title: "", task: false });
  });
});

describe("resolveSessionOwner", () => {
  test("uses the task of a workflow session without reading chats", () => {
    const resolution = resolveSessionOwner({
      identity,
      readOnly: false,
      association: { kind: "workflow", taskId: "task-1", role: "build" },
      readModelLoadState: LOADING,
      activeChats: records(undefined),
      archivedChats: records(undefined),
    });
    expect(resolution).toEqual({
      status: "ready",
      owner: { kind: "task", taskId: "task-1", role: "build" },
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "build" },
      sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
    });
  });

  test("finds the saved chat of a repository session", () => {
    const record = chatRecord();
    const resolution = resolveSessionOwner({
      identity,
      readOnly: false,
      association: { kind: "repository" },
      readModelLoadState: READY,
      activeChats: records([record]),
      archivedChats: records(undefined, { isPending: false }),
    });
    expect(resolution.status === "ready" && resolution.owner).toEqual({ kind: "chat", record });
  });

  test("keeps the same resolution while the chat record stays the same", () => {
    const record = chatRecord();
    const other = chatRecord({ id: "chat-2", externalSessionId: "ext-2" });
    const resolve = (active: WorkspaceSession[]) =>
      resolveSessionOwner({
        identity,
        readOnly: false,
        association: { kind: "repository" },
        readModelLoadState: READY,
        activeChats: records(active),
        archivedChats: records(undefined, { isPending: false }),
      });
    const first = resolve([record, other]);
    // Another chat changed, so the list is new, but this chat keeps its record object.
    expect(resolve([record, { ...other, updatedAt: 2 }])).toBe(first);
    expect(resolve([{ ...record, updatedAt: 2 }, other])).not.toBe(first);
  });

  test("finds an archived chat when the active list does not hold it", () => {
    const record = chatRecord({ archivedAt: 5 });
    const resolution = resolveSessionOwner({
      identity,
      readOnly: false,
      association: null,
      readModelLoadState: READY,
      activeChats: records([]),
      archivedChats: records([record]),
    });
    expect(resolution.status === "ready" && resolution.owner).toEqual({ kind: "chat", record });
  });

  test("waits for the read model before it reports a missing session", () => {
    const resolution = resolveSessionOwner({
      identity,
      readOnly: false,
      association: null,
      readModelLoadState: LOADING,
      activeChats: records([]),
      archivedChats: records([]),
    });
    expect(resolution.status).toBe("loading");
  });

  test("reports a session that the host does not list", () => {
    const resolution = resolveSessionOwner({
      identity,
      readOnly: false,
      association: null,
      readModelLoadState: READY,
      activeChats: records([]),
      archivedChats: records([]),
    });
    expect(resolution).toMatchObject({
      status: "error",
      title: "Session not found",
      canRetry: true,
    });
  });

  test("opens a read-only Subagent session without an owner", () => {
    const resolution = resolveSessionOwner({
      identity,
      readOnly: true,
      association: null,
      readModelLoadState: LOADING,
      activeChats: records(undefined),
      archivedChats: records(undefined),
    });
    expect(resolution).toEqual({
      status: "ready",
      owner: { kind: "none" },
      sessionAssociation: { kind: "unbound" },
      sessionScope: null,
    });
  });

  test("shows a chat read failure with retry", () => {
    const resolution = resolveSessionOwner({
      identity,
      readOnly: false,
      association: null,
      readModelLoadState: READY,
      activeChats: records(undefined, { error: "Host closed the connection.", isPending: false }),
      archivedChats: records(undefined),
    });
    expect(resolution).toEqual({
      status: "error",
      title: "Chats could not load",
      message: "Host closed the connection.",
      canRetry: true,
    });
  });
});

describe("workOwnerParamsFor", () => {
  test("names the task or the chat runtime session", () => {
    expect(workOwnerParamsFor("ws-1", { kind: "task", taskId: "task-1" }, identity)).toEqual({
      workspaceId: "ws-1",
      taskId: "task-1",
    });
    expect(workOwnerParamsFor("ws-1", { kind: "chat" }, identity)).toEqual({
      workspaceId: "ws-1",
      ...identity,
    });
    expect(workOwnerParamsFor("ws-1", { kind: "none" }, identity)).toBeNull();
  });
});

describe("resolveSessionInteraction", () => {
  const ready: SessionInteractionInput = {
    readOnly: false,
    archived: false,
    gateOpen: true,
    runtimeReadiness: { state: "ready", message: null },
    readModelReady: true,
    readModelFailure: null,
    sessionPresent: true,
    faultMessage: null,
    preparation: { ready: true, error: null },
  };

  test("allows commands when every step is ready", () => {
    expect(resolveSessionInteraction(ready)).toEqual({
      canInteract: true,
      blockedReason: null,
      isPreparing: false,
      reasonShown: false,
    });
  });

  test("names the first step that blocks commands", () => {
    expect(
      resolveSessionInteraction({ ...ready, gateOpen: false, readOnly: true }).blockedReason,
    ).toBe("This is a read-only view of a Subagent session.");
    expect(resolveSessionInteraction({ ...ready, gateOpen: false }).blockedReason).toBe(
      "Reconnect to the host to send messages.",
    );
    expect(
      resolveSessionInteraction({
        ...ready,
        runtimeReadiness: { state: "blocked", message: "OpenCode is not installed." },
      }).blockedReason,
    ).toBe("OpenCode is not installed.");
    expect(resolveSessionInteraction({ ...ready, archived: true }).blockedReason).toBe(
      "This chat is archived. Restore it to send messages.",
    );
    expect(
      resolveSessionInteraction({
        ...ready,
        preparation: { ready: false, error: "Reattach failed." },
      }).blockedReason,
    ).toBe("Reattach failed.");
  });

  test("reports preparation while the session gets ready", () => {
    expect(
      resolveSessionInteraction({ ...ready, preparation: { ready: false, error: null } }),
    ).toEqual({
      canInteract: false,
      blockedReason: "Getting the session ready.",
      isPreparing: true,
      reasonShown: true,
    });
  });

  test("leaves to the error row only a reason that no other part of the screen shows", () => {
    const shown = (input: Partial<SessionInteractionInput>) =>
      resolveSessionInteraction({ ...ready, ...input }).reasonShown;
    expect(shown({ gateOpen: false })).toBe(true);
    expect(shown({ archived: true })).toBe(true);
    expect(shown({ faultMessage: "The runtime lost this session." })).toBe(true);
    expect(shown({ preparation: { ready: false, error: "Reattach failed." } })).toBe(true);
    expect(
      shown({ runtimeReadiness: { state: "blocked", message: "OpenCode is not installed." } }),
    ).toBe(false);
  });

  test("leaves the loading reason to the transcript", () => {
    expect(resolveSessionInteraction({ ...ready, readModelReady: false })).toEqual({
      canInteract: false,
      blockedReason: "Loading the session.",
      isPreparing: false,
      reasonShown: true,
    });
  });

  test("names a read model failure instead of loading forever", () => {
    expect(
      resolveSessionInteraction({
        ...ready,
        readModelReady: false,
        readModelFailure: "Failed to load task session records.",
      }),
    ).toEqual({
      canInteract: false,
      blockedReason: "Failed to load task session records.",
      isPreparing: false,
      reasonShown: true,
    });
  });
});

describe("deriveLiveTranscriptState", () => {
  const failed: AgentSessionReadModelLoadState = {
    kind: "failed",
    workspaceRepoPath: "/repo",
    message: "Failed to load task session records.",
    source: "task-records",
  };
  const live = (
    historyLoadState: "not_requested" | "loaded",
    status: "idle" | "running" = "idle",
    resuming = false,
  ) => ({
    session: createAgentSessionFixture({ historyLoadState, status }),
    faultMessage: null,
    runtimeReadinessState: "ready" as const,
    resuming,
  });

  test("names a read model failure instead of loading the history forever", () => {
    expect(
      deriveLiveTranscriptState({ ...live("not_requested"), readModelLoadState: failed }),
    ).toEqual(expect.objectContaining({ kind: "failed", message: failed.message }));
    expect(
      deriveLiveTranscriptState({ ...live("not_requested"), readModelLoadState: LOADING }),
    ).toEqual({ kind: "session_loading", reason: "history" });
  });

  test("keeps a shown history through a read model failure", () => {
    expect(deriveLiveTranscriptState({ ...live("loaded"), readModelLoadState: failed }).kind).toBe(
      "visible",
    );
  });

  test("hides the transcript of a working session while the app resumes", () => {
    const ready: AgentSessionReadModelLoadState = { kind: "ready", workspaceRepoPath: "/repo" };
    const kind = (status: "idle" | "running", resuming: boolean) =>
      deriveLiveTranscriptState({ ...live("loaded", status, resuming), readModelLoadState: ready })
        .kind;
    expect(kind("running", true)).toBe("session_loading");
    expect(kind("idle", true)).toBe("visible");
    expect(kind("running", false)).toBe("visible");
  });
});

describe("mergePendingCounts", () => {
  test("adds approvals and questions of each Subagent session", () => {
    expect(mergePendingCounts({ a: 1 }, { a: 2, b: 1 })).toEqual({ a: 3, b: 1 });
    expect(mergePendingCounts({}, {})).toEqual({});
  });
});

describe("visibleSessionTargetFor", () => {
  const workspace = createWorkspaceRecordFixture({
    workspaceId: "ws-1",
    workspaceName: "Repo",
    repoPath: "/repo",
  });
  const target = (owner: SessionTarget["owner"]): SessionTarget => ({
    workspace,
    repoPath: "/repo",
    identity,
    sessionKey: "key",
    readOnly: false,
    owner,
    sessionAssociation: { kind: "unbound" },
    sessionScope: null,
    workOwner: null,
  });

  test("marks a task session or a chat as visible", () => {
    expect(visibleSessionTargetFor(target({ kind: "task", taskId: "t", role: "qa" }))).toEqual({
      kind: "task_session",
      workspaceId: "ws-1",
      taskId: "t",
      role: "qa",
      identity,
    });
    expect(visibleSessionTargetFor(target({ kind: "chat", record: chatRecord() }))).toEqual({
      kind: "workspace_session",
      workspaceId: "ws-1",
      sessionId: "chat-1",
    });
    expect(visibleSessionTargetFor(target({ kind: "none" }))).toBeNull();
  });
});
