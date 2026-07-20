import { describe, expect, test } from "bun:test";
import { TerminalServiceError } from "@openducktor/host";
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
});
