import { describe, expect, test } from "bun:test";
import {
  type ContinueInterruptedAgentTurnInput,
  workflowAgentSessionScope,
} from "@openducktor/core";
import {
  codexSessionRuntimeRef,
  codexThreadFixture,
  codexThreadStartResultFixture,
  codexTurnFixture,
  makeRuntimeSummary,
} from "./codex-app-server-adapter.test-harness";
import { CodexAppServerAdapter } from "./index";
import type {
  CodexAppServerRequestResult,
  CodexAppServerThreadStatus,
  CodexJsonRpcTransport,
} from "./types";

type RecordedCall = { method: string; params: unknown };

const modelCatalogResult = (): CodexAppServerRequestResult => ({
  data: [
    {
      id: "gpt-5",
      additionalSpeedTiers: [],
      availabilityNux: null,
      model: "gpt-5",
      displayName: "GPT-5",
      description: "GPT-5 model",
      hidden: false,
      supportedReasoningEfforts: [{ reasoningEffort: "medium", description: "Balanced reasoning" }],
      defaultReasoningEffort: "medium",
      defaultServiceTier: null,
      inputModalities: ["text"],
      modelSpecialty: null,
      multiAgentVersion: null,
      serviceTiers: [],
      supportsPersonality: true,
      isDefault: true,
      upgrade: null,
      upgradeInfo: null,
    },
  ],
  nextCursor: null,
});

const createContinuationAdapter = ({
  threadStatus,
  latestTurnStatus,
  cwd = "/repo",
  threadId = "thread-1",
  turnStartError,
  continuationTurnStatus = "inProgress",
  threadSetNameError,
}: {
  threadStatus: CodexAppServerThreadStatus;
  latestTurnStatus: "completed" | "failed" | "inProgress" | "interrupted";
  cwd?: string;
  threadId?: string;
  turnStartError?: Error;
  continuationTurnStatus?: "failed" | "inProgress" | "interrupted";
  threadSetNameError?: () => Error | undefined;
}) => {
  const calls: RecordedCall[] = [];
  let resumeCount = 0;
  const adapter = new CodexAppServerAdapter({
    repoRuntimeResolver: {
      requireRepoRuntime: async ({ repoPath, runtimeKind }) => ({
        ...makeRuntimeSummary("runtime-live"),
        repoPath,
        kind: runtimeKind,
      }),
    },
    transportFactory: (): CodexJsonRpcTransport => ({
      async request({ method, params }) {
        calls.push({ method, params });
        switch (method) {
          case "initialize":
            return {
              codexHome: "/tmp/codex-home",
              platformFamily: "unix",
              platformOs: "macos",
              userAgent: "codex_cli_rs/0.149.0-test",
            };
          case "model/list":
            return modelCatalogResult();
          case "thread/read":
            return {
              thread: codexThreadFixture({
                id: threadId,
                cwd,
                status: threadStatus,
                turns: [
                  codexTurnFixture({
                    id: "turn-1",
                    items: [],
                    status: latestTurnStatus,
                  }),
                ],
              }),
            };
          case "thread/resume": {
            resumeCount += 1;
            return {
              ...codexThreadStartResultFixture(threadId, "thread/resume"),
              thread: codexThreadFixture({
                id: threadId,
                cwd,
                status: threadStatus,
                createdAt: 1_778_112_000 + resumeCount,
              }),
            };
          }
          case "thread/name/set": {
            const renameError = threadSetNameError?.();
            if (renameError) {
              throw renameError;
            }
            return {};
          }
          case "turn/start":
            if (turnStartError) {
              throw turnStartError;
            }
            return {
              turn: codexTurnFixture({
                id: "turn-2",
                items: [],
                status: continuationTurnStatus,
              }),
            };
          default:
            return {};
        }
      },
    }),
    subscribeEvents: () => () => {},
    respondServerRequest: async () => {},
  });
  return { adapter, calls };
};

const continuationInput = (
  overrides: Partial<ContinueInterruptedAgentTurnInput> = {},
): ContinueInterruptedAgentTurnInput => ({
  ...codexSessionRuntimeRef("thread-1"),
  ...overrides,
});

const methodsOf = (calls: RecordedCall[]) => calls.map((call) => call.method);

describe("CodexAppServerAdapter interrupted-turn continuation", () => {
  test("continues an interrupted latest turn with an empty turn/start input", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "interrupted",
    });

    const summary = await adapter.continueInterruptedTurn(continuationInput());

    expect(summary).toMatchObject({
      externalSessionId: "thread-1",
      runtimeKind: "codex",
      workingDirectory: "/repo",
    });
    expect(methodsOf(calls)).toEqual(["model/list", "thread/read", "thread/resume", "turn/start"]);
    const threadRead = calls.find((call) => call.method === "thread/read");
    expect(threadRead?.params).toMatchObject({ threadId: "thread-1", includeTurns: true });
    const turnStart = calls.find((call) => call.method === "turn/start");
    expect(turnStart?.params).toMatchObject({
      threadId: "thread-1",
      input: [],
      approvalPolicy: "on-request",
    });
  });

  test("keeps native settings when continuing an imported repository session", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "interrupted",
    });
    const input = continuationInput({ sessionScope: { kind: "repository" } });
    const source = await adapter.openExistingSession(input);
    await source.attach();
    calls.length = 0;

    await adapter.continueInterruptedTurn(input);

    expect(calls.find((call) => call.method === "thread/resume")?.params).toEqual({
      threadId: "thread-1",
      excludeTurns: true,
    });
    expect(methodsOf(calls)).not.toContain("thread/name/set");
    const turnStart = calls.find((call) => call.method === "turn/start");
    expect(turnStart?.params).not.toHaveProperty("approvalPolicy");
    expect(turnStart?.params).not.toHaveProperty("sandboxPolicy");
    expect(turnStart?.params).not.toHaveProperty("approvalsReviewer");
  });

  test("releases the resumed session when the thread rename fails", async () => {
    const { adapter } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "interrupted",
      threadSetNameError: () => new Error("rename rejected"),
    });

    await expect(
      adapter.continueInterruptedTurn(continuationInput({ sessionScope: { kind: "repository" } })),
    ).rejects.toMatchObject({ reason: "continuation_failed" });

    expect(adapter.listLiveSessionSnapshots("runtime-live")).toEqual([]);
  });

  test("keeps the attached session when the thread rename fails for a continuation", async () => {
    const renameError = new Error("rename rejected");
    let failRename = false;
    const { adapter } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "interrupted",
      threadSetNameError: () => (failRename ? renameError : undefined),
    });
    const resumed = await adapter.resumeSession(
      continuationInput({ sessionScope: { kind: "repository" } }),
    );

    failRename = true;
    await expect(
      adapter.continueInterruptedTurn(continuationInput({ sessionScope: { kind: "repository" } })),
    ).rejects.toMatchObject({ reason: "continuation_failed" });

    const snapshots = adapter.listLiveSessionSnapshots("runtime-live");
    expect(snapshots.map((snapshot) => snapshot.ref.externalSessionId)).toEqual(["thread-1"]);
    expect(snapshots[0]?.startedAt).toBe(resumed.startedAt);
  });

  test("rejects a continuation whose session scope conflicts with the attached session", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "interrupted",
    });
    await adapter.resumeSession(continuationInput());
    calls.length = 0;

    await expect(
      adapter.continueInterruptedTurn(
        continuationInput({ sessionScope: workflowAgentSessionScope("task-2", "build") }),
      ),
    ).rejects.toMatchObject({
      reason: "identity_mismatch",
      message: expect.stringContaining("does not match the requested"),
    });

    expect(methodsOf(calls)).not.toContain("thread/resume");
    expect(methodsOf(calls)).not.toContain("turn/start");
  });

  test("refuses a live thread without starting a turn", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "active", activeFlags: [] },
      latestTurnStatus: "inProgress",
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "live_turn",
    });
    expect(methodsOf(calls)).not.toContain("thread/resume");
    expect(methodsOf(calls)).not.toContain("turn/start");
  });

  test.each([
    ["waitingOnApproval"],
    ["waitingOnUserInput"],
    ["waitingOnApproval", "waitingOnUserInput"],
  ] as const)("classifies active flags %s as waiting input", async (...activeFlags) => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "active", activeFlags: [...activeFlags] },
      latestTurnStatus: "inProgress",
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "waiting_input",
    });
    expect(methodsOf(calls)).not.toContain("thread/resume");
    expect(methodsOf(calls)).not.toContain("turn/start");
  });

  test("classifies a system-error thread as a probe failure instead of a live turn", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "systemError" },
      latestTurnStatus: "interrupted",
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "probe_failed",
      message: expect.stringContaining("Restart the Codex runtime"),
    });
    expect(methodsOf(calls)).not.toContain("thread/resume");
    expect(methodsOf(calls)).not.toContain("turn/start");
  });

  test("refuses a completed latest turn without starting a turn", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "completed",
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "completed_turn",
    });
    expect(methodsOf(calls)).not.toContain("turn/start");
  });

  test("continues a failed latest turn instead of refusing it", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "failed",
    });

    const summary = await adapter.continueInterruptedTurn(continuationInput());

    expect(summary).toMatchObject({ externalSessionId: "thread-1", runtimeKind: "codex" });
    expect(methodsOf(calls)).toContain("turn/start");
  });

  test("refuses a thread that does not match the stored working directory", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "interrupted",
      cwd: "/repo/other",
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "identity_mismatch",
    });
    expect(methodsOf(calls)).not.toContain("turn/start");
  });

  test("reports a typed continuation failure when turn/start rejects", async () => {
    const { adapter, calls } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "interrupted",
      turnStartError: new Error("turn start rejected"),
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "continuation_failed",
      message:
        "Codex could not continue the interrupted turn for session 'thread-1': turn start rejected",
    });
    expect(methodsOf(calls)).toContain("turn/start");
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.activity).toBe("idle");
  });

  test("reports a typed continuation failure when turn/start ends the turn at once", async () => {
    const { adapter } = createContinuationAdapter({
      threadStatus: { type: "idle" },
      latestTurnStatus: "interrupted",
      continuationTurnStatus: "failed",
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "continuation_failed",
      message: expect.stringContaining("ended the continuation turn"),
    });
    expect(adapter.listLiveSessionSnapshots("runtime-live")[0]?.activity).toBe("idle");
  });

  test("reports a missing thread as session_not_found without starting a turn", async () => {
    const calls: RecordedCall[] = [];
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        requireRepoRuntime: async ({ repoPath, runtimeKind }) => ({
          ...makeRuntimeSummary("runtime-live"),
          repoPath,
          kind: runtimeKind,
        }),
      },
      transportFactory: (): CodexJsonRpcTransport => ({
        async request({ method, params }) {
          calls.push({ method, params });
          switch (method) {
            case "initialize":
              return {
                codexHome: "/tmp/codex-home",
                platformFamily: "unix",
                platformOs: "macos",
                userAgent: "codex_cli_rs/0.149.0-test",
              };
            case "model/list":
              return modelCatalogResult();
            case "thread/read":
              throw new Error(
                "Codex app-server request thread/read failed for runtime runtime-live: thread not loaded: thread-1",
              );
            default:
              return {};
          }
        },
      }),
      subscribeEvents: () => () => {},
      respondServerRequest: async () => {},
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "session_not_found",
      message: "Codex thread 'thread-1' no longer exists on the runtime.",
    });
    expect(methodsOf(calls)).not.toContain("thread/resume");
    expect(methodsOf(calls)).not.toContain("turn/start");
  });

  test("reports a failed probe without starting a turn", async () => {
    const calls: RecordedCall[] = [];
    const adapter = new CodexAppServerAdapter({
      repoRuntimeResolver: {
        requireRepoRuntime: async ({ repoPath, runtimeKind }) => ({
          ...makeRuntimeSummary("runtime-live"),
          repoPath,
          kind: runtimeKind,
        }),
      },
      transportFactory: (): CodexJsonRpcTransport => ({
        async request({ method, params }) {
          calls.push({ method, params });
          switch (method) {
            case "initialize":
              return {
                codexHome: "/tmp/codex-home",
                platformFamily: "unix",
                platformOs: "macos",
                userAgent: "codex_cli_rs/0.149.0-test",
              };
            case "model/list":
              return modelCatalogResult();
            case "thread/read":
              throw new Error("thread store unavailable");
            default:
              return {};
          }
        },
      }),
      subscribeEvents: () => () => {},
      respondServerRequest: async () => {},
    });

    await expect(adapter.continueInterruptedTurn(continuationInput())).rejects.toMatchObject({
      reason: "probe_failed",
    });
    expect(methodsOf(calls)).not.toContain("turn/start");
  });
});
