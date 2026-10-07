import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { terminateProcessTree } from "../../infrastructure/process/process-tree";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeHandle } from "../../ports/runtime-registry-port";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createCodexAppServerTransportRegistry as createTransportRegistry } from "./codex-app-server-transport-registry";
import {
  codexStartInput,
  createStarter,
  processIsAlive,
  stubTools,
  waitFor,
  writeCodex,
} from "./codex-runtime-starter.test-support";

/** Process trees can take longer to exit while the full suite runs in parallel. */
const PROCESS_EXIT_TIMEOUT_MS = 3_000;

describe("Codex runtime lifecycle", () => {
  test.each([
    { line: JSON.stringify({ id: 999, result: {} }), message: "unexpected id 999" },
    { line: "{invalid JSON", message: "Invalid Codex app-server JSON" },
    { line: null, message: "closed" },
  ])(
    "reports a fatal $message exit after cleanup so a replacement can start",
    async ({ line, message }) => {
      const root = await mkdtemp(join(tmpdir(), "odt-codex-replacement-"));
      const runtimePidPath = join(root, "runtime.pid");
      const fatalMessagePath = join(root, "fatal.json");
      const childPidPath = join(root, "child.pid");
      const childPids: number[] = [];
      const exits: string[] = [];
      const handles: RuntimeHandle[] = [];
      let starts = 0;
      const codexAppServer = createTransportRegistry();
      const options: Parameters<typeof writeCodex>[1] = {
        runtimePidPath,
        fatalMessagePath,
      };
      if (process.platform !== "win32") options.childPidPath = childPidPath;
      const codexBinary = await writeCodex(root, options);
      const starter = createStarter({
        codexAppServer,
        toolDiscovery: stubTools({ codex: codexBinary }),
        runtimeId: () => `runtime-replacement-${++starts}`,
      });
      const start = async () => {
        const handle = await Effect.runPromise(
          starter.startRuntime(codexStartInput(codexBinary, exits)),
        );
        handles.push(handle);
        return handle;
      };
      try {
        const first = await start();
        const pid = Number(await readFile(runtimePidPath, "utf8"));
        if (process.platform !== "win32") {
          const childPid = Number(await readFile(childPidPath, "utf8"));
          childPids.push(childPid);
          expect(processIsAlive(childPid)).toBe(true);
        }
        if (line === null) {
          process.kill(pid, "SIGTERM");
        } else {
          await writeFile(fatalMessagePath, line);
        }
        await waitFor(() => exits.length === 1);
        // The OS reaps the process tree asynchronously after the exit report.
        await waitFor(
          () => !processIsAlive(pid) && childPids.every((child) => !processIsAlive(child)),
          PROCESS_EXIT_TIMEOUT_MS,
        );
        expect(exits[0]).toContain(message);
        await rm(fatalMessagePath, { force: true });
        const replacement = await start();
        if (process.platform !== "win32") {
          const childPid = Number(await readFile(childPidPath, "utf8"));
          childPids.push(childPid);
          expect(processIsAlive(childPid)).toBe(true);
        }
        expect(starts).toBe(2);
        expect(replacement.runtime.runtimeId).not.toBe(first.runtime.runtimeId);
        await expect(
          Effect.runPromise(
            codexAppServer.request({
              runtimeId: replacement.runtime.runtimeId,
              method: "thread/loaded/list",
              params: {},
            }),
          ),
        ).resolves.toEqual({ data: [], nextCursor: null });
        await expect(Effect.runPromise(replacement.stop())).resolves.toBeUndefined();
        // The OS reaps the stopped process tree asynchronously.
        await waitFor(
          () => childPids.every((child) => !processIsAlive(child)),
          PROCESS_EXIT_TIMEOUT_MS,
        );
        expect(exits).toHaveLength(1);
      } finally {
        for (const handle of handles) await Effect.runPromise(handle.stop().pipe(Effect.ignore));
        for (const childPid of childPids) {
          if (processIsAlive(childPid)) process.kill(childPid, "SIGKILL");
        }
        await removeTestDirectory(root);
      }
    },
  );

  test.each([
    {
      line: JSON.stringify({ id: 999, result: {} }),
      message: "unexpected id 999",
      cleanupFails: false,
    },
    { line: "{invalid JSON", message: "Invalid Codex app-server JSON", cleanupFails: true },
  ])(
    "shares fatal cleanup with concurrent stops for $message",
    async ({ line, message, cleanupFails }) => {
      const root = await mkdtemp(join(tmpdir(), "odt-codex-fatal-"));
      const runtimePidPath = join(root, "runtime.pid");
      const fatalMessagePath = join(root, "fatal.json");
      let handle: RuntimeHandle | null = null;
      let allowCleanup = (): void => {};
      const cleanupGate = new Promise<void>((resolve) => {
        allowCleanup = resolve;
      });
      let releaseCount = 0;
      let cleanupCount = 0;
      let failCleanup = cleanupFails;
      const exits: string[] = [];
      const cleanupFailures: string[] = [];
      try {
        const codexBinary = await writeCodex(root, { runtimePidPath, fatalMessagePath });
        const codexAppServer = createTransportRegistry();
        const starter = createStarter({
          codexAppServer,
          toolDiscovery: stubTools({ codex: codexBinary }),
          runtimeId: () => "runtime-fatal",
          liveSessionLifecycle: {
            registerRuntimeAdapter: () => Effect.void,
            releaseRuntime: () =>
              Effect.sync(() => {
                releaseCount += 1;
                return [];
              }),
            createRuntimeRegistration: (binding) =>
              new AgentSessionLiveRegistration(binding, (mutation) =>
                mutation.pipe(Effect.map((result) => result.value)),
              ),
          },
          processTreeTerminator: (input) =>
            Effect.gen(function* () {
              cleanupCount += 1;
              yield* Effect.promise(() => cleanupGate);
              yield* terminateProcessTree(input);
              if (failCleanup)
                return yield* Effect.fail(
                  new HostOperationError({
                    operation: "test.cleanup",
                    message: "cleanup failed after child close",
                  }),
                );
            }),
        });
        handle = await Effect.runPromise(
          starter.startRuntime(codexStartInput(codexBinary, exits, cleanupFailures)),
        );
        const pid = Number(await readFile(runtimePidPath, "utf8"));
        await writeFile(fatalMessagePath, line);
        await waitFor(() => cleanupCount === 1);
        expect(processIsAlive(pid)).toBe(true);
        expect(releaseCount).toBe(1);
        expect(cleanupCount).toBe(1);
        let stopSettled = false;
        const firstStop = Effect.runPromise(Effect.result(handle.stop())).then((result) => {
          stopSettled = true;
          return result;
        });
        const secondStop = Effect.runPromise(Effect.result(handle.stop()));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(stopSettled).toBe(false);
        // The loss is reported at the failure, while cleanup is still pending.
        expect(exits).toHaveLength(1);
        expect(exits[0]).toContain(message);
        allowCleanup();
        const [firstResult, secondResult] = await Promise.all([firstStop, secondStop]);
        await waitFor(() => !processIsAlive(pid), PROCESS_EXIT_TIMEOUT_MS);
        if (cleanupFails) {
          if (firstResult._tag !== "Failure" || secondResult._tag !== "Failure") {
            throw new Error("Both stop callers must receive the cleanup failure.");
          }
          expect(firstResult.failure).toEqual(secondResult.failure);
          expect(firstResult.failure.message).toContain("cleanup failed after child close");
          // A failed cleanup is reported with its cause.
          await waitFor(() => cleanupFailures.length === 1);
          expect(cleanupFailures[0]).toContain("cleanup failed after child close");
          expect(exits).toHaveLength(1);
        } else {
          expect(firstResult._tag).toBe("Success");
          expect(secondResult._tag).toBe("Success");
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(exits).toHaveLength(1);
        }
        expect(releaseCount).toBe(1);
        expect(cleanupCount).toBe(1);
        if (cleanupFails) {
          // The failed step stays unfinished; an explicit retry runs it again.
          failCleanup = false;
          expect((await Effect.runPromise(Effect.result(handle.stop())))._tag).toBe("Success");
          expect(cleanupCount).toBe(2);
          expect(releaseCount).toBe(1);
          expect(exits).toHaveLength(1);
          expect(cleanupFailures).toHaveLength(1);
        }
        await waitFor(() => !processIsAlive(pid), PROCESS_EXIT_TIMEOUT_MS);
        await expect(
          Effect.runPromise(
            codexAppServer.request({
              runtimeId: "runtime-fatal",
              method: "thread/loaded/list",
              params: {},
            }),
          ),
        ).rejects.toThrow("Codex app-server transport not found");
      } finally {
        allowCleanup();
        if (handle) await Effect.runPromise(handle.stop().pipe(Effect.ignore));
        await removeTestDirectory(root);
      }
    },
  );
});
