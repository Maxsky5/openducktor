import { describe, expect, test } from "bun:test";
import type { ContinueInterruptedAgentTurnInput } from "@openducktor/core";
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
}: {
  threadStatus: CodexAppServerThreadStatus;
  latestTurnStatus: "completed" | "failed" | "inProgress" | "interrupted";
  cwd?: string;
  threadId?: string;
  turnStartError?: Error;
}) => {
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
          case "thread/resume":
            return {
              ...codexThreadStartResultFixture(threadId, "thread/resume"),
              thread: codexThreadFixture({ id: threadId, cwd, status: threadStatus }),
            };
          case "turn/start":
            if (turnStartError) {
              throw turnStartError;
            }
            return {
              turn: codexTurnFixture({
                id: "turn-2",
                items: [],
                status: "inProgress",
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
