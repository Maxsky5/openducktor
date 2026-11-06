import { describe, expect, test } from "bun:test";
import { CodexSessionHistoryError, TaskAssetError, TerminalServiceError } from "@openducktor/host";
import { Cause, Effect, Exit, Option } from "effect";
import { AgentSessionMessageAcceptedError } from "../../../../packages/host/src/ports/agent-session-send-error";
import { createElectronHostInvoke, runElectronHostChannelInvoke } from "./electron-host-invoke";
import {
  HostOperationError,
  OpenDucktorLogPersistenceError,
  RuntimeQueryError,
  hostInvokeFailureFromError,
} from "@openducktor/host";

import { createElectronMainRuntimeBindings } from "./electron-main-runtime-bindings";
import {
  DEFAULT_AGENT_RUNTIMES,
  hostChannelErrorSchema,
  settingsSnapshotSchema,
} from "@openducktor/contracts";
import { createEffectHostCommandRouter } from "../../../../packages/host/src/interface/router/host-command-router";

describe("runElectronHostChannelInvoke", () => {
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
    const response = await runElectronHostChannelInvoke(
      Effect.fail(new RuntimeQueryError({ message: failure.detail, failure })),
    );
    expect(response).toEqual({
      error: {
        kind: "host",
        response: {
          message: failure.detail,
          failure: { kind: "runtime_query", runtimeQueryFailure: failure },
        },
      },
    });
  });
  test("preserves accepted-message failures through the channel reply", async () => {
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
    const response = await runElectronHostChannelInvoke(Effect.fail(error));
    if (!("error" in response)) throw new Error("Expected a host error reply.");
    // The reply crosses the socket as JSON, and the client reads it with the channel schema.
    expect(hostChannelErrorSchema.parse(JSON.parse(JSON.stringify(response.error)))).toMatchObject({
      kind: "host",
      response: { message: error.message, failure: error.failure },
    });
  });

  test("an aborted signal interrupts the command and runs its cleanup", async () => {
    let cleanedUp = false;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const cancel = new AbortController();
    const reply = runElectronHostChannelInvoke(
      Effect.sync(() => started()).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            cleanedUp = true;
          }),
        ),
      ),
      cancel.signal,
    );
    await running;
    cancel.abort(new Error("The client cancelled the request."));
    await reply;

    expect(cleanedUp).toBe(true);
  });

  test("an aborted signal stops a command that runs through the Electron invoke", async () => {
    let cleanedUp = false;
    let started!: () => void;
    const running = new Promise<void>((resolve) => {
      started = resolve;
    });
    const bindings = createElectronMainRuntimeBindings({
      error: () => Effect.void,
      info: () => Effect.void,
      warn: () => Effect.void,
    });
    const invoke = createElectronHostInvoke(
      {
        invoke: () =>
          Effect.sync(() => started()).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                cleanedUp = true;
              }),
            ),
          ),
      },
      bindings,
      { themeSource: "system" },
    );
    const cancel = new AbortController();
    const reply = runElectronHostChannelInvoke(
      invoke("workspace_get_git_provider_context"),
      cancel.signal,
    );
    await running;
    cancel.abort(new Error("The client cancelled the request."));
    await reply;
    await bindings.drainHostCommands();

    expect(cleanedUp).toBe(true);
  });

  test("preserves void command results across the Electron boundary", async () => {
    const response = await runElectronHostChannelInvoke(Effect.void);

    expect(response).toEqual({ result: undefined });
  });

  test("serializes terminal failures instead of losing their code across Electron IPC", async () => {
    const response = await runElectronHostChannelInvoke(
      Effect.fail(
        new TerminalServiceError({
          code: "unsupported_runtime",
          operation: "create",
          message: "Interactive terminals are unavailable in this runtime.",
        }),
      ),
    );

    expect(response).toEqual({
      error: {
        kind: "host",
        response: {
          message: "Interactive terminals are unavailable in this runtime.",
          failure: {
            kind: "terminal",
            terminalFailure: {
              code: "unsupported_runtime",
              message: "Interactive terminals are unavailable in this runtime.",
            },
          },
        },
      },
    });
  });

  test("serializes session history failures with diagnostics", async () => {
    const response = await runElectronHostChannelInvoke(
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
      error: {
        kind: "host",
        response: {
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
      },
    });
  });

  test("serializes task asset partial-state failures for refresh-safe UI handling", async () => {
    const response = await runElectronHostChannelInvoke(
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
      error: {
        kind: "host",
        response: {
          failure: {
            kind: "task_asset",
            taskAssetFailure: {
              code: "partial_state",
              taskId: "task-1",
              retryAllowed: false,
            },
          },
        },
      },
    });
  });
});

test.each(["set_theme", "workspace_get_settings_snapshot"] as const)(
  "%s updates the native theme after success",
  async (command) => {
    const nativeTheme: Parameters<typeof createElectronHostInvoke>[2] = { themeSource: "light" };
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
    const persistenceFailure = new OpenDucktorLogPersistenceError({
      message: "Log write failed.",
      operation: "append",
      path: "/tmp/openducktor.log",
      cause: null,
    });
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
