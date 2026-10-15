import { expect, test } from "bun:test";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { createTerminalSessionEngine } from "./terminal-session-engine";
import { makePty } from "./test-support/terminal-service-harness";

test("initial readiness times out, releases input, and ignores late readiness", async () => {
  const { pty, engine, start } = makeInitial();
  try {
    const action = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* start();
        const input = yield* Effect.result(
          engine.write("initial", new TextEncoder().encode("answer\r")),
        );
        expect(input._tag === "Failure" && input.failure.message).toContain("Action");
        yield* TestClock.adjust("10 seconds");
        return started;
      }).pipe(Effect.provide(TestClock.layer())),
    );
    const result = await Effect.runPromise(action.result.pipe(Effect.timeout("1 second")));
    expect(result.type).toBe("failed");
    expect(result.type === "failed" && result.message).toContain("10 seconds");
    expect(result.type === "failed" && result.message).toContain("prompt");
    await Effect.runPromise(engine.write("initial", new TextEncoder().encode("answer\r")));
    expect(pty.operations).toEqual(["write:answer\r"]);
    const resumed = Promise.withResolvers<void>();
    const stop = engine.observeActivity((event) => {
      if (event.type === "activity_updated" && event.activity.command === "print resumed")
        resumed.resolve();
    });
    try {
      const nonce = pty.launches[0]!.commandNonce!;
      pty.emit(
        new TextEncoder().encode(
          `\u001b]633;R;${nonce};1\u0007\u001b]633;E;print\\x20resumed;${nonce};1\u0007\u001b]633;C\u0007`,
        ),
      );
      await resumed.promise;
      expect(pty.operations).toEqual(["write:answer\r"]);
      expect(await Effect.runPromise(action.result)).toEqual(result);
    } finally {
      stop();
    }
  } finally {
    await Effect.runPromise(engine.dispose());
  }
}, 3000);

test("closing an Action before readiness prevents late submission", async () => {
  const { pty, engine, start } = makeInitial();
  try {
    const action = await Effect.runPromise(
      Effect.gen(function* () {
        const started = yield* start();
        yield* engine.close("initial", true);
        yield* TestClock.adjust("10 seconds");
        return started;
      }).pipe(Effect.provide(TestClock.layer())),
    );
    expect((await Effect.runPromise(action.result)).type).toBe("closed");
    const nonce = pty.launches[0]!.commandNonce!;
    pty.emit(new TextEncoder().encode(`\u001b]633;R;${nonce};1\u0007`));
    expect(pty.operations).toEqual(["terminate"]);
  } finally {
    await Effect.runPromise(engine.dispose());
  }
});

function makeInitial() {
  const pty = makePty();
  const engine = createTerminalSessionEngine({ now: () => new Date(), ptyPort: pty.port });
  const shell = {
    shell: "/bin/zsh",
    args: ["-il"],
    env: {},
    cwd: "/repo",
    grid: { columns: 80, rows: 24 },
  };
  return {
    pty,
    engine,
    start: () =>
      engine.startCommand(
        {
          terminalId: "initial",
          label: "Action",
          context: {},
          initialWorkingDir: "/repo",
          createdAt: "2026-10-15T00:00:00Z",
          lifecycle: "starting",
          exit: null,
          startedBy: "user",
        },
        { commandLines: ["print ACTION"] },
        {
          shell,
          command: {
            ...shell,
            interactiveCommand: ["print ACTION"],
          },
        },
      ),
  };
}
