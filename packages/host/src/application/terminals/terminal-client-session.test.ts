import { describe, expect, test } from "bun:test";
import { TERMINAL_PROTOCOL_VERSION, type TerminalServerMessage } from "@openducktor/contracts";
import { Effect } from "effect";
import { createTerminalClientSession } from "./terminal-client-session";
import type { TerminalService } from "./terminal-service";
import { TerminalServiceError } from "./terminal-service-error";

describe("TerminalClientSession", () => {
  test("serializes client frames behind an asynchronous attach", async () => {
    const operations: string[] = [];
    let releaseAttach = (): void => undefined;
    const attachBlocked = new Promise<void>((resolve) => {
      releaseAttach = resolve;
    });
    const service = {
      attach: () =>
        Effect.gen(function* () {
          operations.push("attach:start");
          yield* Effect.promise(() => attachBlocked);
          operations.push("attach:complete");
        }),
      acknowledge: () => Effect.sync(() => operations.push("ack")),
    } as unknown as TerminalService;
    const session = createTerminalClientSession({
      clientId: "test-client",
      terminalService: service,
      send: () => undefined,
    });

    const attaching = Effect.runPromise(
      session.handle(
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "attach",
          terminalId: "terminal-1",
          lastConsumedSequence: null,
        },
        new Uint8Array(),
      ),
    );
    const acknowledging = Effect.runPromise(
      session.handle(
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "ack",
          terminalId: "terminal-1",
          sequenceEnd: 0,
        },
        new Uint8Array(),
      ),
    );
    await Promise.resolve();
    expect(operations).toEqual(["attach:start"]);

    releaseAttach();
    await Promise.all([attaching, acknowledging]);
    expect(operations).toEqual(["attach:start", "attach:complete", "ack"]);
  });

  test("maps stale attaches and detaches every live attachment on close", async () => {
    const sent: TerminalServerMessage[] = [];
    const detached: string[] = [];
    let rejectAttach = true;
    const service = {
      attach: ({ terminalId }: Parameters<TerminalService["attach"]>[0]) =>
        rejectAttach
          ? Effect.fail(
              new TerminalServiceError({
                code: "terminal_not_found",
                operation: "attach",
                message: `Terminal not found: ${terminalId}`,
                terminalId,
              }),
            )
          : Effect.void,
      detach: (terminalId: string, attachmentId: string) =>
        Effect.sync(() => detached.push(`${terminalId}:${attachmentId}`)),
    } as unknown as TerminalService;
    const session = createTerminalClientSession({
      clientId: "test-client",
      terminalService: service,
      send: (message) => sent.push(message),
    });
    const attach = (terminalId: string) =>
      Effect.runPromise(
        session.handle(
          {
            version: TERMINAL_PROTOCOL_VERSION,
            type: "attach",
            terminalId,
            lastConsumedSequence: null,
          },
          new Uint8Array(),
        ),
      );

    await attach("missing");
    expect(sent[0]).toMatchObject({
      type: "protocol_error",
      failure: { code: "terminal_forgotten" },
    });

    rejectAttach = false;
    await attach("terminal-1");
    await attach("terminal-2");
    await Effect.runPromise(session.close());
    expect(detached).toEqual([
      "terminal-1:test-client:terminal-1",
      "terminal-2:test-client:terminal-2",
    ]);
  });
});
