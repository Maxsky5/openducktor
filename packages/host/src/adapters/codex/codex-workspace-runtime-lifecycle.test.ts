import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import { terminateProcessTree } from "../../infrastructure/process/process-tree";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type { RuntimeWorkspaceHandle } from "../../ports/runtime-registry-port";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createRuntimeRegistry } from "../runtimes/runtime-registry";
import { createCodexAppServerTransportRegistry as createTransportRegistry } from "./codex-app-server-transport-registry";
import {
  createStarter,
  processIsAlive,
  stubTools,
  waitFor,
  writeCodex,
} from "./codex-workspace-runtime-starter.test-support";

describe("Codex runtime lifecycle", () => {
  test.each([
    { line: JSON.stringify({ id: 999, result: {} }), message: "unexpected id 999" },
    { line: "{invalid JSON", message: "Invalid Codex app-server JSON" },
    { line: null, message: "closed" },
  ])(
    "replaces a runtime through the registry after fatal $message cleanup",
    async ({ line, message }) => {
      const root = await mkdtemp(join(tmpdir(), "odt-codex-replacement-"));
      const runtimePidPath = join(root, "runtime.pid");
      const fatalMessagePath = join(root, "fatal.json");
      const childPidPath = join(root, "child.pid");
      const childPids: number[] = [];
      const failures: HostOperationErrorAggregate[] = [];
      const handles: RuntimeWorkspaceHandle[] = [];
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
        onRuntimeFailure: (failure) =>
          Effect.sync(() => {
            failures.push(failure);
          }),
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
      });
      const registry = createRuntimeRegistry({
        workspaceStarter: {
          startWorkspaceRuntime: (input) =>
            starter.startWorkspaceRuntime(input).pipe(
              Effect.tap((handle) =>
                Effect.sync(() => {
                  handles.push(handle);
                }),
              ),
            ),
        },
      });
      const input = {
        runtimeKind: "codex",
        repoPath: root,
        workingDirectory: root,
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
      };
      try {
        const first = await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
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
        await waitFor(() => failures.length === 1);
        expect(handles[0]?.isAlive()).toBe(false);
        expect(processIsAlive(pid)).toBe(false);
        for (const childPid of childPids) expect(processIsAlive(childPid)).toBe(false);
        expect(failures[0]?.message).toContain(message);
        await rm(fatalMessagePath, { force: true });
        const replacement = await Effect.runPromise(registry.ensureWorkspaceRuntime(input));
        if (process.platform !== "win32") {
          const childPid = Number(await readFile(childPidPath, "utf8"));
          childPids.push(childPid);
          expect(processIsAlive(childPid)).toBe(true);
        }
        expect(starts).toBe(2);
        expect(replacement.runtimeId).not.toBe(first.runtimeId);
        expect(handles[1]?.isAlive()).toBe(true);
        await expect(
          Effect.runPromise(registry.findRuntimeById(first.runtimeId)),
        ).resolves.toBeNull();
        await expect(Effect.runPromise(registry.listRuntimes())).resolves.toEqual([replacement]);
        await expect(Effect.runPromise(registry.ensureWorkspaceRuntime(input))).resolves.toEqual(
          replacement,
        );
        expect(starts).toBe(2);
        await expect(
          Effect.runPromise(
            codexAppServer.request({
              runtimeId: replacement.runtimeId,
              method: "thread/loaded/list",
              params: {},
            }),
          ),
        ).resolves.toEqual({ data: [], nextCursor: null });
        await expect(Effect.runPromise(registry.stopRuntime(replacement.runtimeId))).resolves.toBe(
          true,
        );
        await expect(Effect.runPromise(registry.listRuntimes())).resolves.toEqual([]);
        for (const childPid of childPids) expect(processIsAlive(childPid)).toBe(false);
        expect(failures).toHaveLength(1);
      } finally {
        await Effect.runPromise(registry.stopAllRuntimes().pipe(Effect.ignore));
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
      let handle: RuntimeWorkspaceHandle | null = null;
      let allowCleanup = (): void => {};
      const cleanupGate = new Promise<void>((resolve) => {
        allowCleanup = resolve;
      });
      let releaseCount = 0;
      let cleanupCount = 0;
      const failures: HostOperationErrorAggregate[] = [];
      try {
        const codexBinary = await writeCodex(root, { runtimePidPath, fatalMessagePath });
        const codexAppServer = createTransportRegistry();
        const starter = createStarter({
          codexAppServer,
          toolDiscovery: stubTools({ codex: codexBinary }),
          runtimeId: () => "runtime-fatal",
          onRuntimeFailure: (failure) =>
            Effect.sync(() => {
              failures.push(failure);
            }),
          resolveMcpBridgeConnection: () =>
            Effect.succeed({
              workspaceId: "repo",
              hostUrl: "http://127.0.0.1:14327",
              hostToken: "token-1",
            }),
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
              if (cleanupFails)
                return yield* Effect.fail(
                  new HostOperationError({
                    operation: "test.cleanup",
                    message: "cleanup failed after child close",
                  }),
                );
            }),
        });
        handle = await Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "codex",
            repoPath: root,
            workingDirectory: root,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
          }),
        );
        const pid = Number(await readFile(runtimePidPath, "utf8"));
        await writeFile(fatalMessagePath, line);
        await waitFor(() => cleanupCount === 1);
        expect(handle.isAlive()).toBe(false);
        expect(processIsAlive(pid)).toBe(true);
        expect(releaseCount).toBe(1);
        expect(cleanupCount).toBe(1);
        let stopSettled = false;
        const firstStop = Effect.runPromise(Effect.either(handle.stop())).then((result) => {
          stopSettled = true;
          return result;
        });
        const secondStop = Effect.runPromise(Effect.either(handle.stop()));
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(stopSettled).toBe(false);
        allowCleanup();
        const [firstResult, secondResult] = await Promise.all([firstStop, secondStop]);
        await waitFor(() => failures.length === 1);
        const reportedFailure = failures[0];
        expect(reportedFailure?.message).toContain(message);
        expect(reportedFailure?.cause).toBeInstanceOf(Error);
        if (reportedFailure?.cause instanceof Error)
          expect(reportedFailure.cause.message).toContain(message);
        if (cleanupFails) {
          if (firstResult._tag !== "Left" || secondResult._tag !== "Left") {
            throw new Error("Both stop callers must receive the cleanup failure.");
          }
          expect(firstResult.left).toBe(secondResult.left);
          expect(reportedFailure).toBe(firstResult.left);
          expect(firstResult.left.message).toContain("cleanup failed after child close");
        } else {
          expect(firstResult._tag).toBe("Right");
          expect(secondResult._tag).toBe("Right");
          expect(reportedFailure?.message).not.toContain("Cleanup failed");
        }
        expect(releaseCount).toBe(1);
        expect(cleanupCount).toBe(1);
        await waitFor(() => !processIsAlive(pid));
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
