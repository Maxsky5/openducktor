import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { TerminalServiceError } from "../../application/terminals/terminal-service-error";
import { createTerminalCommandHandlers } from "./terminal-command-handlers";

const closeInput = { terminalId: "terminal-1", confirmTerminate: false };

type TerminalCommandService = Parameters<typeof createTerminalCommandHandlers>[0];

const createService = <Overrides extends Partial<TerminalCommandService>>(
  overrides: Overrides,
): TerminalCommandService => ({
  close: () => Effect.die("close is not configured for this test"),
  create: () => Effect.die("create is not configured for this test"),
  list: () => Effect.die("list is not configured for this test"),
  preparePathInput: () => Effect.die("preparePathInput is not configured for this test"),
  ...overrides,
});

const invokeClose = (service: TerminalCommandService) => {
  const handler = createTerminalCommandHandlers(service).terminal_close;
  if (!handler) throw new Error("Expected the terminal_close handler.");
  return Effect.runPromise(handler(closeInput, { command: "terminal_close", args: closeInput }));
};

const invokePreparePathInput = (service: TerminalCommandService) => {
  const input = { terminalId: "terminal-1", paths: ["/tmp/image.png"] };
  const handler = createTerminalCommandHandlers(service).terminal_prepare_path_input;
  if (!handler) throw new Error("Expected the terminal_prepare_path_input handler.");
  return Effect.runPromise(handler(input, { command: "terminal_prepare_path_input", args: input }));
};

describe("createTerminalCommandHandlers", () => {
  test("delegates path-input preparation to the host terminal", async () => {
    const service = createService({
      preparePathInput: () => Effect.succeed({ text: "'/tmp/image.png'" }),
    });

    await expect(invokePreparePathInput(service)).resolves.toEqual({ text: "'/tmp/image.png'" });
  });

  test("returns a typed confirmation response only for blocking terminal work", async () => {
    const service = createService({
      close: () =>
        Effect.fail(
          new TerminalServiceError({
            code: "confirmation_required",
            operation: "close",
            message: "The terminal has running child processes.",
            terminalId: "terminal-1",
          }),
        ),
    });

    await expect(invokeClose(service)).resolves.toEqual({
      closed: false,
      confirmationRequired: true,
    });
  });

  test("propagates close failures that are not confirmation requests", async () => {
    const service = createService({
      close: () =>
        Effect.fail(
          new TerminalServiceError({
            code: "close_failed",
            operation: "close",
            message: "Unable to inspect terminal child processes.",
            terminalId: "terminal-1",
          }),
        ),
    });

    await expect(invokeClose(service)).rejects.toThrow(
      "Unable to inspect terminal child processes.",
    );
  });
});
