import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { Effect, Fiber } from "effect";
import { createFakeOpenCodeV2 } from "../../test-support/opencode-v2-standalone";
import { createOpenCodeExecutableProbe } from "./opencode-executable-probe";

describe("OpenCode V2 executable probe", () => {
  test("uses native stdio readiness, authentication, inherited config, and releases stdin", async () => {
    const fixture = await createFakeOpenCodeV2();
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const probe = createOpenCodeExecutableProbe({
        readEnv: () => ({
          ...process.env,
          OPENCODE_CONFIG_CONTENT: '{"custom":true}',
          ODT_TEST_MARKER: "inherited",
        }),
        spawnProcess: (command, args, options) => {
          const started = spawn(command, args, options);
          child = started;
          return started;
        },
      });
      await Effect.runPromise(probe.probeExecutable(fixture.executablePath));
      const record = await fixture.readRecord();
      expect(record).toMatchObject({
        args: ["serve", "--stdio", "--port", "0", "--hostname", "127.0.0.1"],
        config: '{"custom":true}',
        marker: "inherited",
        requests: [{ path: "/api/info", authorized: true }],
      });
      expect(record.passwordLength).toBeGreaterThanOrEqual(40);
      expect(child?.stdin?.writableEnded).toBe(true);
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
    } finally {
      child?.kill();
      await fixture.cleanup();
    }
  });
  const expectedFailures = {
    v1: {
      tag: "RuntimeExecutableIncompatibleError",
      detail:
        "did not report an authenticated OpenCode 2 server. OpenDucktor needs OpenCode 2 or later. Run `opencode upgrade`",
    },
    malformed: {
      tag: "RuntimeExecutableIncompatibleError",
      detail: 'printed "OpenCode server listening" instead of the OpenCode 2 readiness line.',
    },
    silent: {
      tag: "HostOperationError",
      detail:
        "did not start: it was not ready within 0.08 seconds. Fix the reported problem, or run `opencode upgrade`",
    },
    exit: {
      tag: "HostOperationError",
      detail: "did not start: it stopped before it was ready: native startup failed.",
    },
  } as const;
  for (const mode of ["v1", "malformed", "silent", "exit"] as const) {
    test(`fails with an actionable error and cleans up a ${mode} executable`, async () => {
      const fixture = await createFakeOpenCodeV2(mode);
      let child: ReturnType<typeof spawn> | undefined;
      try {
        const probe = createOpenCodeExecutableProbe({
          startupTimeoutMs: mode === "silent" ? 80 : 500,
          spawnProcess: (command, args, options) => {
            const started = spawn(command, args, options);
            child = started;
            return started;
          },
        });
        const failure = await Effect.runPromise(
          Effect.flip(probe.probeExecutable(fixture.executablePath)),
        );
        expect(failure._tag).toBe(expectedFailures[mode].tag);
        expect(failure.message).toContain(expectedFailures[mode].detail);
        expect(failure.message).toEndWith("Then try again.");
        expect(child?.stdin?.writableEnded).toBe(true);
      } finally {
        child?.kill();
        await fixture.cleanup();
      }
    });
  }
  test("interruption releases a child that has not sent readiness", async () => {
    const fixture = await createFakeOpenCodeV2("silent");
    let child: ReturnType<typeof spawn> | undefined;
    let spawned!: () => void;
    const started = new Promise<void>((resolve) => {
      spawned = resolve;
    });
    try {
      const probe = createOpenCodeExecutableProbe({
        spawnProcess: (command, args, options) => {
          const running = spawn(command, args, options);
          child = running;
          spawned();
          return running;
        },
      });
      const fiber = Effect.runFork(probe.probeExecutable(fixture.executablePath));
      await started;
      await Effect.runPromise(Fiber.interrupt(fiber));
      expect(child?.stdin?.writableEnded).toBe(true);
      expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
    } finally {
      child?.kill();
      await fixture.cleanup();
    }
  });
});
