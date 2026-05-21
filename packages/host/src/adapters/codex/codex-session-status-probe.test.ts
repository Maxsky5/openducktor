import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { CodexAppServerRequestResult } from "../../ports/codex-app-server-port";
import { probeCodexSessionStatus } from "./codex-session-status-probe";

const codexResult = (value: unknown) => Effect.succeed(value as CodexAppServerRequestResult);

const probeThreadStatus = (input: {
  status: { type: "active"; activeFlags: [] } | { type: "idle" | "notLoaded" | "systemError" };
  cwd?: string;
}) =>
  Effect.runPromise(
    probeCodexSessionStatus({
      codexAppServer: {
        request() {
          return codexResult({
            thread: {
              id: "thread-1",
              cwd: input.cwd ?? "/repo/worktree",
              status: input.status,
            },
          });
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
});
