import { describe, expect, test } from "bun:test";
import type {
  WorkspaceSession,
  WorkspaceSessionLaunchRequest,
  WorkspaceSessionLaunchResult,
} from "@openducktor/contracts";
import { draftToSerializedText } from "../../drafts/agent-chat-composer-draft";
import { createAgentSessionsStore } from "../../sessions/agent-sessions-store";
import { findDraftStartupAttempt } from "../../sessions/startup/startup-navigation";
import { createStartupLiveSourceFake } from "../../test-support/startup-live-source-fake";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { launchWorkspaceSessionDraft } from "./launch-workspace-session-draft";

const WORKSPACE_ID = "ws-1";
const REPO_PATH = "/repo";

const savedRecord = (overrides: Partial<WorkspaceSession> = {}): WorkspaceSession => ({
  id: "saved-1",
  runtimeKind: "codex",
  externalSessionId: "native-1",
  executionTarget: { kind: "local_repo_root", workingDirectory: REPO_PATH },
  roleSnapshot: null,
  selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
  generatedTitle: "Session title",
  manualTitle: null,
  targetBranch: { remote: "origin", branch: "main" },
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
  ...overrides,
});

const launchRequest = (draftId: string): WorkspaceSessionLaunchRequest => ({
  workspaceId: WORKSPACE_ID,
  repoPath: REPO_PATH,
  draftId,
  runtimeKind: "codex",
  selectedModel: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-5" },
  customAgentRoleId: null,
  targetBranch: { remote: "origin", branch: "main" },
  location: "local_repo_root",
  parts: [{ kind: "text", text: "Hello world" }],
});

const composerWithText = (text: string) => ({
  segments: [{ id: "t1", kind: "text" as const, text }],
  attachments: [],
});

const runtimeSession = {
  externalSessionId: "native-1",
  runtimeKind: "codex" as const,
  workingDirectory: REPO_PATH,
  startedAt: "2026-10-27T00:00:00.000Z",
  status: "idle" as const,
};

describe("launchWorkspaceSessionDraft", () => {
  test("completes launch, retires draft, and notifies saved and bound callbacks", async () => {
    const record = savedRecord();
    let live!: ReturnType<typeof createStartupLiveSourceFake>;
    const connection = createTestClientConnection({
      client: {
        workspaceSessionLaunch: async (request): Promise<WorkspaceSessionLaunchResult> => ({
          workspaceId: WORKSPACE_ID,
          repoPath: REPO_PATH,
          status: "completed",
          sessionId: record.id,
          record,
          session: runtimeSession,
          startupProgress: request.startup
            ? live.prepared({
                context: request.startup,
                workspaceId: WORKSPACE_ID,
                repoPath: REPO_PATH,
                scope: { kind: "workspace", sessionId: record.id, draftId: request.draftId },
                ownership: {
                  state: "saved",
                  target: { kind: "workspace", record, runtimeSession },
                },
              })
            : undefined,
        }),
      },
    });
    live = createStartupLiveSourceFake(connection.queryClient);

    const draft = connection.drafts.newWorkspaceSessions.createDraft(WORKSPACE_ID);
    const submittedComposer = composerWithText("Hello world");
    connection.drafts.newWorkspaceSessions.updateComposer(draft.id, submittedComposer);
    const savedRecords: string[] = [];
    const boundRecords: string[] = [];

    const outcome = await launchWorkspaceSessionDraft({
      connection,
      sessions: createAgentSessionsStore(),
      draftId: draft.id,
      submittedComposer,
      request: launchRequest(draft.id),
      onSavedRecord: (saved) => savedRecords.push(saved.id),
      onBoundRecord: (bound) => boundRecords.push(bound.id),
    });

    expect(outcome.error).toBeNull();
    expect(connection.drafts.newWorkspaceSessions.getDraft(draft.id)).toBeNull();
    expect(savedRecords).toEqual([record.id]);
    expect(boundRecords).toEqual([record.id]);
  });

  test("pre-save failure keeps draft editable with Edit choices and Retry actions", async () => {
    let calls = 0;
    const record = savedRecord();
    let live!: ReturnType<typeof createStartupLiveSourceFake>;
    const connection = createTestClientConnection({
      client: {
        workspaceSessionLaunch: async (request): Promise<WorkspaceSessionLaunchResult> => {
          calls += 1;
          if (calls === 1) {
            return {
              workspaceId: WORKSPACE_ID,
              repoPath: REPO_PATH,
              status: "failed",
              failure: { message: "Branch already exists.", cleanupErrors: [] },
            };
          }
          return {
            workspaceId: WORKSPACE_ID,
            repoPath: REPO_PATH,
            status: "completed",
            sessionId: record.id,
            record,
            session: runtimeSession,
            startupProgress: request.startup
              ? live.prepared({
                  context: request.startup,
                  workspaceId: WORKSPACE_ID,
                  repoPath: REPO_PATH,
                  scope: { kind: "workspace", sessionId: record.id, draftId: request.draftId },
                  ownership: {
                    state: "saved",
                    target: { kind: "workspace", record, runtimeSession },
                  },
                })
              : undefined,
          };
        },
      },
    });
    live = createStartupLiveSourceFake(connection.queryClient);

    const draft = connection.drafts.newWorkspaceSessions.createDraft(WORKSPACE_ID);
    const submittedComposer = composerWithText("Hello world");
    connection.drafts.newWorkspaceSessions.updateComposer(draft.id, submittedComposer);
    const preSaveErrors: string[] = [];

    const first = await launchWorkspaceSessionDraft({
      connection,
      sessions: createAgentSessionsStore(),
      draftId: draft.id,
      submittedComposer,
      request: launchRequest(draft.id),
      onPreSaveError: (error) => preSaveErrors.push(error.message),
    });

    expect(first.error?.message).toBe("Branch already exists.");
    expect(preSaveErrors).toEqual(["Branch already exists."]);
    expect(connection.drafts.newWorkspaceSessions.getDraft(draft.id)?.lifecycle).toBe("retained");
    expect(connection.drafts.newWorkspaceSessions.isStarting(draft.id)).toBe(false);
    expect(findDraftStartupAttempt(connection.startupAttempts.getSnapshot(), draft.id)?.id).toBe(
      first.startupAttemptId,
    );

    const actions = connection.startupAttempts.getAttempt(first.startupAttemptId)?.recoveryActions;
    expect(actions?.map((a) => a.kind)).toEqual(["edit_choices", "retry"]);

    const retryAction = actions?.find((a) => a.kind === "retry");
    await retryAction?.run();
    expect(calls).toBe(2);
    expect(connection.drafts.newWorkspaceSessions.getDraft(draft.id)).toBeNull();
  });

  test("post-save send failure retires draft and copies unsent text to the saved session composer", async () => {
    const record = savedRecord();
    let live!: ReturnType<typeof createStartupLiveSourceFake>;
    const connection = createTestClientConnection({
      client: {
        workspaceSessionLaunch: async (request): Promise<WorkspaceSessionLaunchResult> => ({
          workspaceId: WORKSPACE_ID,
          repoPath: REPO_PATH,
          status: "failed",
          sessionId: record.id,
          record,
          session: runtimeSession,
          unsentInstruction: request.parts,
          failure: { message: "Initial send rejected.", cleanupErrors: [] },
          startupProgress: request.startup
            ? {
                ...live.prepared({
                  context: request.startup,
                  workspaceId: WORKSPACE_ID,
                  repoPath: REPO_PATH,
                  scope: { kind: "workspace", sessionId: record.id, draftId: request.draftId },
                  ownership: {
                    state: "saved",
                    target: { kind: "workspace", record, runtimeSession },
                  },
                }),
                phase: "failed",
                instruction: { state: "not_sent" },
              }
            : undefined,
        }),
      },
    });
    live = createStartupLiveSourceFake(connection.queryClient);

    const draft = connection.drafts.newWorkspaceSessions.createDraft(WORKSPACE_ID);
    const submittedComposer = composerWithText("Preserve me");
    connection.drafts.newWorkspaceSessions.updateComposer(draft.id, submittedComposer);

    await launchWorkspaceSessionDraft({
      connection,
      sessions: createAgentSessionsStore(),
      draftId: draft.id,
      submittedComposer,
      request: launchRequest(draft.id),
    });

    expect(connection.drafts.newWorkspaceSessions.getDraft(draft.id)).toBeNull();
    const preserved = connection.drafts.chat.hydrate(
      { workspaceId: WORKSPACE_ID, workspaceSessionId: record.id },
      null,
    );
    expect(draftToSerializedText(preserved)).toBe("Preserve me");
  });

  test("post-save unbound failure installs Retry session preparation and binds on repair", async () => {
    const unbound = savedRecord({ externalSessionId: null });
    const bound = savedRecord({ externalSessionId: "native-1" });
    let live!: ReturnType<typeof createStartupLiveSourceFake>;
    const connection = createTestClientConnection({
      client: {
        workspaceSessionLaunch: async (request): Promise<WorkspaceSessionLaunchResult> => ({
          workspaceId: WORKSPACE_ID,
          repoPath: REPO_PATH,
          status: "failed",
          sessionId: unbound.id,
          record: unbound,
          unsentInstruction: request.parts,
          failure: { message: "Runtime unavailable.", cleanupErrors: [] },
        }),
        workspaceSessionStart: async (request) => ({
          session: bound,
          runtimeSession,
          startupProgress: request.startup
            ? live.prepared({
                context: request.startup,
                workspaceId: WORKSPACE_ID,
                repoPath: REPO_PATH,
                scope: { kind: "workspace", sessionId: bound.id },
                ownership: {
                  state: "saved",
                  target: { kind: "workspace", record: bound, runtimeSession },
                },
              })
            : undefined,
        }),
      },
    });
    live = createStartupLiveSourceFake(connection.queryClient);

    const draft = connection.drafts.newWorkspaceSessions.createDraft(WORKSPACE_ID);
    const submittedComposer = composerWithText("Retry bind");
    connection.drafts.newWorkspaceSessions.updateComposer(draft.id, submittedComposer);

    const outcome = await launchWorkspaceSessionDraft({
      connection,
      sessions: createAgentSessionsStore(),
      draftId: draft.id,
      submittedComposer,
      request: launchRequest(draft.id),
    });

    const repairAction = connection.startupAttempts
      .getAttempt(outcome.startupAttemptId)
      ?.recoveryActions?.find((a) => a.kind === "repair");
    expect(repairAction).toBeDefined();

    await repairAction?.run();
    const repairedAttempt = connection.startupAttempts.getAttempt(outcome.startupAttemptId);
    expect(repairedAttempt?.status.phase).toBe("ready");
    expect(repairedAttempt?.ownership.state).toBe("saved");
    if (
      repairedAttempt?.ownership.state === "saved" &&
      repairedAttempt.ownership.target.kind === "workspace"
    ) {
      expect(repairedAttempt.ownership.target.record.externalSessionId).toBe("native-1");
    }
  });

  test("discarding a failed draft releases its unsaved startup attempt", async () => {
    const connection = createTestClientConnection({
      client: {
        workspaceSessionLaunch: async (): Promise<WorkspaceSessionLaunchResult> => ({
          workspaceId: WORKSPACE_ID,
          repoPath: REPO_PATH,
          status: "failed",
          failure: { message: "Worktree failed.", cleanupErrors: [] },
        }),
      },
    });
    const draft = connection.drafts.newWorkspaceSessions.createDraft(WORKSPACE_ID);
    const submittedComposer = composerWithText("Will discard");
    connection.drafts.newWorkspaceSessions.updateComposer(draft.id, submittedComposer);

    const outcome = await launchWorkspaceSessionDraft({
      connection,
      sessions: createAgentSessionsStore(),
      draftId: draft.id,
      submittedComposer,
      request: launchRequest(draft.id),
    });
    expect(connection.startupAttempts.getAttempt(outcome.startupAttemptId)).not.toBeNull();

    expect(connection.drafts.newWorkspaceSessions.discard(draft.id)).toBe(true);
    expect(connection.startupAttempts.getAttempt(outcome.startupAttemptId)).toBeNull();
  });
});
