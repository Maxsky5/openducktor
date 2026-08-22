import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import type { ProcessTreeTerminator } from "../../infrastructure/process/process-tree";
import {
  buildOpenCodeExecutableProbeEnvironment,
  createOpenCodeExecutableProbe,
} from "./opencode-executable-probe";

describe("createOpenCodeExecutableProbe", () => {
  test("starts the selected executable as a local server and checks its health protocol", async () => {
    const spawnCalls: Array<{ command: string; args: string[] }> = [];
    const readinessCalls: Array<[number, number]> = [];
    const stoppedPids: number[] = [];
    const child = Object.assign(new EventEmitter(), {
      pid: 42,
      stdin: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    const processTreeTerminator: ProcessTreeTerminator = (input) => {
      stoppedPids.push(input.pid);
      return Effect.void;
    };
    const probe = createOpenCodeExecutableProbe({
      portAllocator: () => Effect.succeed(4567),
      processEnv: { PATH: "/usr/bin" },
      processTreeTerminator,
      readinessProbe(port, timeoutMs) {
        readinessCalls.push([port, timeoutMs]);
        return Effect.succeed(true);
      },
      spawnProcess(command, args) {
        spawnCalls.push({ command, args });
        // SAFETY: This test controls the fixture and supplies `never` used by this case.
        return child as never;
      },
    });

    await Effect.runPromise(probe.probeExecutable("/usr/local/bin/opencode"));

    expect(spawnCalls).toEqual([
      {
        command: "/usr/local/bin/opencode",
        args: ["serve", "--hostname", "127.0.0.1", "--port", "4567"],
      },
    ]);
    expect(readinessCalls).toEqual([[4567, 250]]);
    expect(stoppedPids).toEqual([42]);
  });

  test("handles a spawn error after a child is returned without a pid", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: undefined,
      stdin: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    // SAFETY: This test controls the fixture and supplies `never` used by this case.
    const probe = createOpenCodeExecutableProbe({
      portAllocator: () => Effect.succeed(4567),
      spawnProcess: () => child as never,
    });

    const exit = await Effect.runPromiseExit(probe.probeExecutable("/missing/opencode"));

    expect(exit._tag).toBe("Failure");
    expect(child.listenerCount("error")).toBe(1);
    expect(() => child.emit("error", new Error("spawn failed"))).not.toThrow();
  });

  test("preserves an operational failure when the server exits before readiness", async () => {
    const child = Object.assign(new EventEmitter(), {
      pid: 42,
      stdin: null,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    // SAFETY: This test controls the fixture and supplies `never` used by this case.
    const probe = createOpenCodeExecutableProbe({
      portAllocator: () => Effect.succeed(4567),
      processTreeTerminator: () => Effect.void,
      readinessProbe: () => {
        child.emit("close", 2);
        return Effect.succeed(false);
      },
      retryDelayMs: 1,
      spawnProcess: () => child as never,
    });

    const failure = await Effect.runPromise(
      Effect.flip(probe.probeExecutable("/usr/local/bin/not-opencode")),
    );

    expect(failure._tag).toBe("HostOperationError");
    if (failure._tag !== "HostOperationError") {
      throw new Error(`Expected HostOperationError, received ${failure._tag}`);
    }
    expect(failure.operation).toBe("opencodeExecutableProbe.startServer");
  });
});

describe("buildOpenCodeExecutableProbeEnvironment", () => {
  test("removes inherited server authentication from the private health probe", () => {
    expect(
      buildOpenCodeExecutableProbeEnvironment({
        OPENCODE_SERVER_USERNAME: "user",
        OPENCODE_SERVER_PASSWORD: "password",
        PATH: "/usr/bin",
      }),
    ).toEqual({
      OPENCODE_CONFIG_CONTENT: '{"logLevel":"INFO"}',
      PATH: "/usr/bin",
    });
  });
});
