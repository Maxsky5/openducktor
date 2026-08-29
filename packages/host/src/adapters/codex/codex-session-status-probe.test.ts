import { describe, expect, test } from "bun:test";
import {
  parseCodexAppServerRequestResult,
  type CodexAppServerThread,
  type CodexAppServerThreadStatus,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { probeCodexSessionStatus } from "./codex-session-status-probe";

const codexThread = (status: CodexAppServerThreadStatus, cwd = "/repo/worktree") =>
  ({
    id: "thread-1",
    extra: null,
    sessionId: "thread-1",
    forkedFromId: null,
    parentThreadId: null,
    preview: "Test thread",
    ephemeral: false,
    section: null,
    sectionEnteredAt: null,
    projectId: null,
    historyMode: "paginated",
    modelProvider: "openai",
    createdAt: 1,
    updatedAt: 1,
    recencyAt: 1,
    status,
    path: null,
    cwd,
    cliVersion: "0.149.0-test",
    source: "appServer",
    canAcceptDirectInput: true,
    threadSource: null,
    agentNickname: null,
    agentRole: null,
    gitInfo: null,
    name: null,
    turns: [],
  }) satisfies CodexAppServerThread;

const probeThreadStatus = (input: { status: CodexAppServerThreadStatus; cwd?: string }) =>
  Effect.runPromise(
    probeCodexSessionStatus({
      codexAppServer: {
        request() {
          return Effect.succeed(
            parseCodexAppServerRequestResult("thread/read", {
              thread: codexThread(input.status, input.cwd),
            }),
          );
        },
      },
      runtimeId: "runtime-1",
      externalSessionId: "thread-1",
      workingDirectory: "/repo/worktree",
    }),
  );

describe("probeCodexSessionStatus", () => {
  test("reports active and systemError Codex threads as live", async () => {
    await expect(
      probeThreadStatus({ status: { type: "active", activeFlags: [] } }),
    ).resolves.toEqual({
      supported: true,
      hasLiveSession: true,
    });

    await expect(probeThreadStatus({ status: { type: "systemError" } })).resolves.toEqual({
      supported: true,
      hasLiveSession: true,
    });
  });

  test("reports idle, notLoaded, and other-worktree Codex threads as inactive", async () => {
    await expect(probeThreadStatus({ status: { type: "idle" } })).resolves.toEqual({
      supported: true,
      hasLiveSession: false,
    });

    await expect(probeThreadStatus({ status: { type: "notLoaded" } })).resolves.toEqual({
      supported: true,
      hasLiveSession: false,
    });

    await expect(
      probeThreadStatus({ status: { type: "active", activeFlags: [] }, cwd: "/repo/other" }),
    ).resolves.toEqual({
      supported: true,
      hasLiveSession: false,
    });
  });

  test("reports missing Codex threads as inactive", async () => {
    await expect(
      Effect.runPromise(
        probeCodexSessionStatus({
          codexAppServer: {
            request() {
              return Effect.fail(
                new HostOperationError({
                  operation: "codexAppServer.request",
                  message: "thread not found",
                  details: { method: "thread/read" },
                }),
              );
            },
          },
          runtimeId: "runtime-1",
          externalSessionId: "thread-missing",
          workingDirectory: "/repo/worktree",
        }),
      ),
    ).resolves.toEqual({
      supported: true,
      hasLiveSession: false,
    });
  });

  test("rejects an unsupported thread status at the protocol boundary", () => {
    expect(() =>
      parseCodexAppServerRequestResult("thread/read", {
        thread: { ...codexThread({ type: "idle" }), status: { type: "paused" } },
      }),
    ).toThrow("Invalid discriminator value");
  });
});
