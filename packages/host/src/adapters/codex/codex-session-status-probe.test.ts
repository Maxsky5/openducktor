import { describe, expect, test } from "bun:test";
import {
  parseCodexAppServerRequestResult,
  type CodexAppServerThread,
  type CodexAppServerThreadStatus,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { createCodexDirectoryMatcher } from "./codex-directory-identity";
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
    model: null,
    reasoningEffort: null,
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

const directoriesMatch = createCodexDirectoryMatcher({
  canonicalize: (path) => Effect.succeed(path),
});

const deletedDirectoryMatch = createCodexDirectoryMatcher({
  canonicalize: (path) =>
    Effect.fail(
      new HostOperationError({
        operation: "filesystem.canonicalize",
        message: `ENOENT: no such file or directory, realpath '${path}'`,
      }),
    ),
});

const probeThreadStatus = (input: {
  status: CodexAppServerThreadStatus;
  cwd?: string;
  directoriesMatch?: typeof directoriesMatch;
}) =>
  Effect.runPromise(
    probeCodexSessionStatus({
      directoriesMatch: input.directoriesMatch ?? directoriesMatch,
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
  test("reports active Codex threads as live", async () => {
    await expect(
      probeThreadStatus({ status: { type: "active", activeFlags: [] } }),
    ).resolves.toEqual({
      supported: true,
      hasLiveSession: true,
    });
  });

  test("reports idle, notLoaded, systemError, and other-worktree Codex threads as inactive", async () => {
    await expect(probeThreadStatus({ status: { type: "systemError" } })).resolves.toEqual({
      supported: true,
      hasLiveSession: false,
    });

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

  test("does not resolve the directories of a thread that is not live", async () => {
    for (const status of [{ type: "notLoaded" }, { type: "systemError" }] as const) {
      await expect(
        probeThreadStatus({
          status,
          cwd: "/private/repo/worktree",
          directoriesMatch: deletedDirectoryMatch,
        }),
      ).resolves.toEqual({ supported: true, hasLiveSession: false });
    }
  });

  test("reports a directory failure for a live thread", async () => {
    await expect(
      probeThreadStatus({
        status: { type: "active", activeFlags: [] },
        cwd: "/private/repo/worktree",
        directoriesMatch: deletedDirectoryMatch,
      }),
    ).rejects.toThrow("ENOENT");
  });

  test("reports missing Codex threads as inactive", async () => {
    await expect(
      Effect.runPromise(
        probeCodexSessionStatus({
          directoriesMatch,
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
});
