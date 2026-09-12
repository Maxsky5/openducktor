import { describe, expect, test } from "bun:test";
import { CodexSessionHistoryError, TaskAssetError, TerminalServiceError } from "@openducktor/host";
import { Effect } from "effect";
import { runElectronHostInvoke } from "./electron-host-invoke";
import { RuntimeQueryError } from "@openducktor/host";

describe("runElectronHostInvoke", () => {
  test("preserves runtime query identity and diagnostics across Electron IPC", async () => {
    const failure = {
      code: "invalid_runtime_response" as const,
      operation: "load session history",
      repoPath: "/repo",
      runtimeKind: "codex" as const,
      workingDirectory: "/repo/worktree",
      externalSessionId: "thread-1",
      summary: "Could not load session history.",
      detail: "Check the host runtime logs.",
      sessionHistoryFailure: {
        code: "invalid_runtime_response" as const,
        summary: "Codex returned invalid history.",
        detail: "A history item has an invalid shape.",
        diagnosticId: "diagnostic-1",
        method: "thread/turns/list" as const,
        pageCursor: null,
      },
    };
    const response = await runElectronHostInvoke(
      Effect.fail(new RuntimeQueryError({ message: failure.detail, failure })),
    );
    expect(response).toEqual({
      ok: false,
      error: {
        message: failure.detail,
        failure: { kind: "runtime_query", runtimeQueryFailure: failure },
      },
    });
  });
  test("preserves void command results across the Electron boundary", async () => {
    const response = await runElectronHostInvoke(Effect.void);

    expect(response).toEqual({ ok: true, value: undefined });
  });

  test("serializes terminal failures instead of losing their code across Electron IPC", async () => {
    const response = await runElectronHostInvoke(
      Effect.fail(
        new TerminalServiceError({
          code: "unsupported_runtime",
          operation: "create",
          message: "Interactive terminals are unavailable in this runtime.",
        }),
      ),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        message: "Interactive terminals are unavailable in this runtime.",
        failure: {
          kind: "terminal",
          terminalFailure: {
            code: "unsupported_runtime",
            message: "Interactive terminals are unavailable in this runtime.",
          },
        },
      },
    });
  });

  test("serializes session history failures with diagnostics", async () => {
    const response = await runElectronHostInvoke(
      Effect.fail(
        new CodexSessionHistoryError({
          message: "Codex thread/turns/list response data[0] must be an object",
          runtimeId: "runtime-1",
          threadId: "thread-1",
          failure: {
            code: "invalid_runtime_response",
            summary: "Codex returned invalid conversation history.",
            detail: "Codex thread/turns/list response data[0] must be an object",
            diagnosticId: "diagnostic-1",
            method: "thread/turns/list",
            pageCursor: null,
          },
        }),
      ),
    );

    expect(response).toEqual({
      ok: false,
      error: {
        message: "Codex thread/turns/list response data[0] must be an object",
        failure: {
          kind: "session_history",
          sessionHistoryFailure: {
            code: "invalid_runtime_response",
            summary: "Codex returned invalid conversation history.",
            detail: "Codex thread/turns/list response data[0] must be an object",
            diagnosticId: "diagnostic-1",
            method: "thread/turns/list",
            pageCursor: null,
          },
        },
      },
    });
  });

  test("serializes task asset partial-state failures for refresh-safe UI handling", async () => {
    const response = await runElectronHostInvoke(
      Effect.fail(
        new TaskAssetError({
          operation: "create",
          code: "partial_state",
          taskId: "task-1",
          assetIds: ["550e8400-e29b-41d4-a716-446655440000"],
          failedPhase: "compensate_create",
          durableState: "created_partial",
          retryAllowed: false,
          message: "Refresh before continuing.",
        }),
      ),
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        failure: {
          kind: "task_asset",
          taskAssetFailure: {
            code: "partial_state",
            taskId: "task-1",
            retryAllowed: false,
          },
        },
      },
    });
  });
});
