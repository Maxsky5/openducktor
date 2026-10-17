import { describe, expect, test } from "bun:test";
import { CodexSessionHistoryError, TaskAssetError, TerminalServiceError } from "@openducktor/host";
import { Cause, Effect, Exit, Option } from "effect";
import { AgentSessionMessageAcceptedError } from "../../../../packages/host/src/ports/agent-session-send-error";
import { createElectronHostInvoke, runElectronHostInvoke } from "./electron-host-invoke";
import {
  HostOperationError,
  RuntimeQueryError,
  hostInvokeFailureFromError,
} from "@openducktor/host";

import { createElectronMainRuntimeBindings } from "./electron-main-runtime-bindings";
import { DEFAULT_AGENT_RUNTIMES, settingsSnapshotSchema } from "@openducktor/contracts";
import { createEffectHostCommandRouter } from "../../../../packages/host/src/interface/router/host-command-router";

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
  test("preserves accepted-message failures through main and preload IPC validation", async () => {
    const { createElectronHostInvoke } = await import("../preload/electron-host-invoke");
    const error = new AgentSessionMessageAcceptedError(
      {
        sessionRef: {
          repoPath: "/repo",
          runtimeKind: "codex",
          workingDirectory: "/repo",
          externalSessionId: "native",
        },
        acceptedMessage: {
          type: "user_message",
          externalSessionId: "native",
          messageId: "message-1",
          timestamp: "2026-09-12T10:00:00Z",
          message: "Hello",
          parts: [],
          state: "read",
        },
        stage: "record_message",
      },
      new Error("Save failed"),
    );
    const response = await runElectronHostInvoke(Effect.fail(error));
    const invoke = createElectronHostInvoke({
      invoke: async () => ({ status: "success", payload: structuredClone(response) }),
    });
    await expect(invoke("agent_session_message_submit")).resolves.toMatchObject({
      ok: false,
      error: { message: error.message, failure: error.failure },
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

test.each(["set_theme", "workspace_get_settings_snapshot"] as const)(
  "%s updates the native theme after success",
  async (command) => {
    const nativeTheme = { themeSource: "light" } satisfies Parameters<
      typeof createElectronHostInvoke
    >[2];
    const snapshot = settingsSnapshotSchema.parse({
      theme: "dark",
      agentRuntimes: DEFAULT_AGENT_RUNTIMES,
    });
    let failure: HostOperationError | null = null;
    const router = createEffectHostCommandRouter({
      handlers: {
        set_theme: () => (failure ? Effect.fail(failure) : Effect.void),
        workspace_get_settings_snapshot: () =>
          failure ? Effect.fail(failure) : Effect.succeed(snapshot),
      },
    });
    const bindings = createElectronMainRuntimeBindings({
      error: () => Effect.void,
      info: () => Effect.void,
      warn: () => Effect.void,
    });
    const invoke = createElectronHostInvoke(router, bindings, nativeTheme);
    try {
      await Effect.runPromise(invoke(command, { theme: "dark" }));
      expect(nativeTheme.themeSource).toBe("dark");
      failure = new HostOperationError({
        operation: command,
        message: "Settings could not be saved.",
      });
      await expect(Effect.runPromise(invoke(command, { theme: "system" }))).rejects.toBe(failure);
      expect(nativeTheme.themeSource).toBe("dark");
    } finally {
      await bindings.drainHostCommands();
    }
  },
);

test.each([false, true])(
  "commands preserve partial outcomes and logging failures (logging fails: %s)",
  async (loggingFails) => {
    const commandFailure = new TaskAssetError({
      operation: "create",
      code: "partial_state",
      taskId: "task-1",
      assetIds: ["550e8400-e29b-41d4-a716-446655440000"],
      failedPhase: "compensate_create",
      durableState: "created_partial",
      retryAllowed: false,
      message: "Refresh before continuing.",
    });
    const persistenceFailure = new Error("Log write failed.");
    const bindings = createElectronMainRuntimeBindings({
      error: () => (loggingFails ? Effect.fail(persistenceFailure) : Effect.void),
      info: () => Effect.void,
      warn: () => Effect.void,
    });
    const invoke = createElectronHostInvoke(
      { invoke: () => Effect.fail(commandFailure) },
      bindings,
      { themeSource: "system" },
    );
    const result = await Effect.runPromiseExit(invoke("task_asset_create"));
    if (!Exit.isFailure(result)) throw new Error("Expected command failure.");
    const failure = Cause.findErrorOption(result.cause);
    if (Option.isNone(failure)) throw new Error("Expected a typed command failure.");
    const cause = failure.value;
    if (loggingFails) {
      expect(cause).not.toBe(commandFailure);
      expect(cause).toMatchObject({
        message: expect.stringContaining("could not be persisted"),
        cause: { details: { commandFailure, persistenceFailure } },
      });
    } else {
      expect(cause).toBe(commandFailure);
    }
    expect(hostInvokeFailureFromError(cause)).toMatchObject({
      kind: "task_asset",
      taskAssetFailure: { code: "partial_state", retryAllowed: false, taskId: "task-1" },
    });
    await bindings.drainHostCommands();
  },
);
