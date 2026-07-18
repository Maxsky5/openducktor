import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { TerminalService } from "../../application/terminals/terminal-service";
import { TerminalServiceError } from "../../application/terminals/terminal-service-error";
import { createTerminalCommandHandlers } from "./terminal-command-handlers";

const closeInput = { terminalId: "terminal-1", confirmTerminate: false };

const createService = (close: TerminalService["close"]): TerminalService =>
  ({ close }) as TerminalService;

const invokeClose = (service: TerminalService) => {
  const handler = createTerminalCommandHandlers(service).terminal_close;
  if (!handler) throw new Error("Expected the terminal_close handler.");
  return Effect.runPromise(handler(closeInput, { command: "terminal_close", args: closeInput }));
};

const invokePreparePathInput = (service: TerminalService) => {
  const input = { terminalId: "terminal-1", paths: ["/tmp/image.png"] };
  const handler = createTerminalCommandHandlers(service).terminal_prepare_path_input;
  if (!handler) throw new Error("Expected the terminal_prepare_path_input handler.");
  return Effect.runPromise(handler(input, { command: "terminal_prepare_path_input", args: input }));
};

describe("createTerminalCommandHandlers", () => {
  test("delegates path-input preparation to the host terminal", async () => {
    const service = {
      preparePathInput: () => Effect.succeed({ text: "'/tmp/image.png'" }),
    } as unknown as TerminalService;

    await expect(invokePreparePathInput(service)).resolves.toEqual({ text: "'/tmp/image.png'" });
  });

  test("returns a typed confirmation response only for blocking terminal work", async () => {
    const service = createService(() =>
      Effect.fail(
        new TerminalServiceError({
          code: "confirmation_required",
          operation: "close",
          message: "The terminal has running child processes.",
          terminalId: "terminal-1",
        }),
      ),
    );

    await expect(invokeClose(service)).resolves.toEqual({
      closed: false,
      confirmationRequired: true,
    });
  });

  test("propagates close failures that are not confirmation requests", async () => {
    const service = createService(() =>
      Effect.fail(
        new TerminalServiceError({
          code: "close_failed",
          operation: "close",
          message: "Unable to inspect terminal child processes.",
          terminalId: "terminal-1",
        }),
      ),
    );

    await expect(invokeClose(service)).rejects.toThrow(
      "Unable to inspect terminal child processes.",
    );
  });
});
