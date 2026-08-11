import { describe, expect, test } from "bun:test";
import { CodexSessionHistoryError, TerminalServiceError } from "@openducktor/host";
import { Effect } from "effect";
import { runElectronHostInvoke } from "./electron-host-invoke";

describe("runElectronHostInvoke", () => {
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
});
