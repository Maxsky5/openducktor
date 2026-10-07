import { describe, expect, test } from "bun:test";
import {
  TERMINAL_PROTOCOL_VERSION,
  type TerminalClientMessage,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import { Deferred, Effect, Fiber } from "effect";
import { createTerminalClientSession } from "./terminal-client-session";
import type { TerminalService } from "./terminal-service";
import { TerminalServiceError } from "./terminal-service-error";

type TerminalClientService = Parameters<typeof createTerminalClientSession>[0]["terminalService"];

const createTerminalClientService = <Overrides extends Partial<TerminalClientService>>(
  overrides: Overrides,
): TerminalClientService => ({
  acknowledge: () => Effect.die("acknowledge is not configured for this test"),
  attach: () => Effect.die("attach is not configured for this test"),
  detach: () => Effect.die("detach is not configured for this test"),
  resize: () => Effect.die("resize is not configured for this test"),
  write: () => Effect.die("write is not configured for this test"),
  observeActivity: () => Effect.die("observeActivity is not configured for this test"),
  ...overrides,
});

describe("TerminalClientSession", () => {
  test("writes input frames in arrival order when one arrives right after a release", async () => {
    const writes: number[] = [];
    const firstEntered = Deferred.makeUnsafe<void>();
    const releaseFirst = Deferred.makeUnsafe<void>();
    const session = createTerminalClientSession({
      clientId: "test-client",
      terminalService: createTerminalClientService({
        write: (_terminalId, payload) =>
          Effect.gen(function* () {
            if (payload[0] === 1) {
              yield* Deferred.succeed(firstEntered, undefined);
              yield* Deferred.await(releaseFirst);
            }
            writes.push(payload[0] ?? -1);
          }),
      }),
      send: () => undefined,
    });
    const input = (byte: number) =>
      Effect.runFork(
        session.handle(
          { version: TERMINAL_PROTOCOL_VERSION, type: "input", terminalId: "terminal-1" },
          new Uint8Array([byte]),
        ),
      );

    const first = input(1);
    await Effect.runPromise(Deferred.await(firstEntered));
    const second = input(2);
    await Effect.runPromise(Deferred.succeed(releaseFirst, undefined));
    await Effect.runPromise(Fiber.join(first));
    const third = input(3);

    await Effect.runPromise(Fiber.join(second));
    await Effect.runPromise(Fiber.join(third));
    expect(writes).toEqual([1, 2, 3]);
  });

  test("serializes client frames behind an asynchronous attach", async () => {
    const operations: string[] = [];
    let releaseAttach = (): void => undefined;
    const attachBlocked = new Promise<void>((resolve) => {
      releaseAttach = resolve;
    });
    const service = createTerminalClientService({
      attach: () =>
        Effect.gen(function* () {
          operations.push("attach:start");
          yield* Effect.promise(() => attachBlocked);
          operations.push("attach:complete");
        }),
      acknowledge: () => Effect.sync(() => operations.push("ack")),
    });
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
    const service = createTerminalClientService({
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
    });
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

  test("rejects frames after a failed close and keeps unfinished cleanup available", async () => {
    const operations: string[] = [];
    const sent: TerminalServerMessage[] = [];
    let failDetach = true;
    const session = createTerminalClientSession({
      clientId: "test-client",
      terminalService: createTerminalClientService({
        attach: () => Effect.sync(() => operations.push("attach")),
        write: () => Effect.sync(() => operations.push("write")),
        resize: () => Effect.sync(() => operations.push("resize")),
        acknowledge: () => Effect.sync(() => operations.push("ack")),
        detach: (terminalId) =>
          Effect.suspend(() => {
            operations.push("detach");
            return failDetach
              ? Effect.fail(
                  new TerminalServiceError({
                    code: "output_overflow",
                    operation: "detach",
                    message: "Injected output resume failure",
                    terminalId,
                  }),
                )
              : Effect.void;
          }),
      }),
      send: (message) => sent.push(message),
    });
    const base = { version: TERMINAL_PROTOCOL_VERSION, terminalId: "terminal-1" };
    const attach: TerminalClientMessage = { ...base, type: "attach", lastConsumedSequence: null };
    await Effect.runPromise(session.handle(attach, new Uint8Array()));
    await expect(Effect.runPromise(session.close())).rejects.toMatchObject({
      message: expect.stringContaining("Injected output resume failure"),
    });

    const frames: TerminalClientMessage[] = [
      attach,
      { ...base, type: "input" },
      { ...base, type: "resize", columns: 80, rows: 24 },
      { ...base, type: "ack", sequenceEnd: 0 },
      { ...base, type: "detach" },
    ];
    for (const frame of frames) {
      await Effect.runPromise(session.handle(frame, new Uint8Array()));
    }
    expect(operations).toEqual(["attach", "detach"]);
    expect(sent).toHaveLength(5);
    for (const message of sent) {
      expect(message).toMatchObject({
        type: "protocol_error",
        terminalId: "terminal-1",
        failure: { code: "protocol_error", message: expect.stringContaining("closed") },
      });
    }

    failDetach = false;
    await Effect.runPromise(session.close());
    await Effect.runPromise(session.close());
    expect(operations).toEqual(["attach", "detach", "detach"]);
  });

  test("retries an attachment after a protocol detach fails", async () => {
    const detachAttempts: string[] = [];
    let failDetach = true;
    const session = createTerminalClientSession({
      clientId: "test-client",
      terminalService: createTerminalClientService({
        attach: () => Effect.void,
        detach: (terminalId, attachmentId) =>
          Effect.suspend(() => {
            detachAttempts.push(attachmentId);
            return failDetach
              ? Effect.fail(
                  new TerminalServiceError({
                    code: "close_failed",
                    operation: "detach",
                    message: "Injected detach failure",
                    terminalId,
                  }),
                )
              : Effect.void;
          }),
      }),
      send: () => undefined,
    });
    await Effect.runPromise(
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
    await Effect.runPromise(
      session.handle(
        { version: TERMINAL_PROTOCOL_VERSION, type: "detach", terminalId: "terminal-1" },
        new Uint8Array(),
      ),
    );
    failDetach = false;
    await Effect.runPromise(session.close());
    expect(detachAttempts).toEqual(["test-client:terminal-1", "test-client:terminal-1"]);
  });
});
