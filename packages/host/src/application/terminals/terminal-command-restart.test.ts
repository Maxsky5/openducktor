import { afterAll, expect, test } from "bun:test";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import {
  makeService,
  makePty,
  removeFakeShell,
  waitForPtyOperation,
} from "./test-support/terminal-service-harness";

afterAll(removeFakeShell);

const harness = async () => {
  const { service, pty } = await makeService(makePty(true, false));
  const terminal = await Effect.runPromise(service.create({ workingDir: "/repo", context: {} }));
  const terminalId = terminal.ref.terminalId;
  const nonce = pty.launches[0]!.commandNonce!;
  const emit = async (marker: string) => {
    pty.emit(new TextEncoder().encode(`\u001b]633;${marker}\u0007`));
    await Bun.sleep(10);
  };
  const start = (complete = "1") => emit(`E;sleep\\x2030;${nonce};${complete}\u0007\u001b]633;C`);
  const restart = (expectedCommand = "sleep 30") =>
    service.restart({ terminalId, expectedCommand });
  return { service, pty, terminalId, nonce, emit, start, restart };
};

test("restart rejects stale requests, waits for authenticated ZLE readiness, and excludes concurrent input", async () => {
  const { service, pty, terminalId, nonce, emit, start, restart } = await harness();
  try {
    await start();
    const stale = await Effect.runPromise(Effect.result(restart("bun dev")));
    expect(stale._tag === "Failure" && stale.failure.message).toContain("changed");
    expect(pty.operations).toEqual([]);
    const pending = Effect.runPromise(restart());
    await waitForPtyOperation(pty.operations, "write:\u0003");
    const duplicate = await Effect.runPromise(Effect.result(restart()));
    expect(duplicate._tag === "Failure" && duplicate.failure.message).toContain("already");
    const input = await Effect.runPromise(
      Effect.result(service.write(terminalId, new TextEncoder().encode("ls\r"))),
    );
    expect(input._tag === "Failure" && input.failure.message).toContain("restart");
    await emit("D;0;another-shell");
    expect(pty.operations).toEqual(["write:\u0003"]);
    await emit(`D;130;${nonce}`);
    expect(pty.operations).toEqual(["write:\u0003"]);
    await emit("R;another-shell");
    expect(pty.operations).toEqual(["write:\u0003"]);
    await emit(`R;${nonce}`);
    expect(await pending).toEqual({ restarted: true });
    expect(pty.operations).toEqual(["write:\u0003", "write:\u001b[200~sleep 30\u001b[201~\r"]);
  } finally {
    await Effect.runPromise(service.dispose());
  }
});

test.each(["0", ""])("restart refuses an incomplete command marker (%s)", async (complete) => {
  const { service, pty, start, restart } = await harness();
  try {
    await start(complete);
    const result = await Effect.runPromise(Effect.result(restart()));
    expect(result._tag === "Failure" && result.failure.message).toContain("no command");
    expect(pty.operations).toEqual([]);
  } finally {
    await Effect.runPromise(service.dispose());
  }
});

test.each(["running", "prompt"])(
  "a restart timeout during %s ignores late readiness and unblocks input",
  async (phase) => {
    const { service, pty, terminalId, nonce, emit, start, restart } = await harness();
    try {
      await start();
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const pending = yield* Effect.forkChild(Effect.result(restart()));
          yield* Effect.promise(() => waitForPtyOperation(pty.operations, "write:\u0003"));
          if (phase === "prompt") yield* Effect.promise(() => emit(`D;0;${nonce}`));
          yield* TestClock.adjust("10 seconds");
          return yield* Fiber.join(pending);
        }).pipe(Effect.provide(TestClock.layer())),
      );
      expect(result._tag === "Failure" && result.failure.message).toContain("did not become ready");
      await emit(`D;0;${nonce}`);
      await emit(`R;${nonce}`);
      expect(pty.operations).toEqual(["write:\u0003"]);
      await Effect.runPromise(service.write(terminalId, new TextEncoder().encode("ls\r")));
      expect(pty.operations.at(-1)).toBe("write:ls\r");
    } finally {
      await Effect.runPromise(service.dispose());
    }
  },
);

test.each(["running", "prompt"])(
  "closing a terminal during %s never reruns the command",
  async (phase) => {
    const { service, pty, terminalId, nonce, emit, start, restart } = await harness();
    try {
      await start();
      const pending = Effect.runPromise(Effect.result(restart()));
      await waitForPtyOperation(pty.operations, "write:\u0003");
      if (phase === "prompt") await emit(`D;0;${nonce}`);
      await Effect.runPromise(service.close({ terminalId, confirmTerminate: true }));
      const result = await pending;
      expect(result._tag === "Failure" && result.failure.message).toContain("closed");
      expect(pty.operations.filter((operation) => operation.startsWith("write:"))).toEqual([
        "write:\u0003",
      ]);
    } finally {
      await Effect.runPromise(service.dispose());
    }
  },
);
