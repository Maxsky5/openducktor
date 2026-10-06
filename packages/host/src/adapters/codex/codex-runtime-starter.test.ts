import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import { terminateProcessTree } from "../../infrastructure/process/process-tree";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type { CodexAppServerStreamEvent } from "../../ports/codex-app-server-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeHandle, RuntimeStartInput } from "../../ports/runtime-registry-port";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { createCodexAppServerTransportRegistry as createTransportRegistry } from "./codex-app-server-transport-registry";
import {
  createStarter,
  processIsAlive,
  stubCommands,
  stubTools,
  codexStartInput,
  waitFor,
  waitForEvents,
  writeCodex,
} from "./codex-runtime-starter.test-support";

describe("createCodexRuntimeStarter", () => {
  test.each(["spawn", "initialize", "register", "forward"])(
    "cleans up startup failure at %s",
    async (stage) => {
      const root = await mkdtemp(join(tmpdir(), "odt-codex-startup-failure-"));
      const runtimePidPath = join(root, "runtime.pid");
      let discardCount = 0;
      let releaseCount = 0;
      const exits: string[] = [];
      const startupFailure = new HostOperationError({
        operation: "test.startup",
        message: `${stage} failed`,
      });
      try {
        const binary = await writeCodex(root, {
          runtimePidPath,
          hangRequestMethods: stage === "initialize" ? ["initialize"] : [],
        });
        const codexBinary = stage === "spawn" ? join(root, "missing") : binary;
        const codexAppServer = createTransportRegistry();
        const starter = createStarter({
          codexAppServer,
          toolDiscovery: stubTools({ codex: codexBinary }),
          runtimeId: () => "runtime-startup-failure",
          // The fake app-server must start and write its pid before the initialize timeout,
          // also while the full suite runs in parallel.
          requestTimeoutMs: stage === "initialize" ? 3_000 : 4_000,
          liveSessionLifecycle: {
            registerRuntimeAdapter: () =>
              stage === "register" ? Effect.fail(startupFailure) : Effect.void,
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
          prepareLiveSessionAdapter: (runtime) =>
            Effect.succeed({
              adapter: createAgentSessionRuntimeAdapterTestDouble(
                {
                  runtimeId: runtime.runtimeId,
                  runtimeKind: "codex",
                },
                {},
              ),
              emitRuntimeEvent: () => {},
              startForwarding: () =>
                stage === "forward" ? Effect.fail(startupFailure) : Effect.void,
              discard: () =>
                Effect.sync(() => {
                  discardCount += 1;
                }),
            }),
          processTreeTerminator: (input) =>
            terminateProcessTree(input).pipe(
              Effect.andThen(
                stage === "register"
                  ? Effect.fail(
                      new HostOperationError({
                        operation: "test.cleanup",
                        message: "cleanup failure during startup",
                      }),
                    )
                  : Effect.void,
              ),
            ),
        });
        const ownedCleanups: Parameters<RuntimeStartInput["ownCleanup"]>[0][] = [];
        const failure = await Effect.runPromise(
          Effect.flip(starter.startRuntime(codexStartInput(codexBinary, exits, [], ownedCleanups))),
        );
        if (stage === "spawn") expect(failure.message).toContain("no valid pid");
        if (stage === "initialize")
          expect(failure.message).toContain(
            "Timed out waiting for Codex app-server request initialize",
          );
        if (stage === "register" || stage === "forward")
          expect(failure.message).toContain(startupFailure.message);
        // The starter leaves cleanup to the host, which runs the owned cleanup once.
        expect(failure.message).not.toContain("Cleanup failed");
        expect(ownedCleanups).toHaveLength(1);
        const [ownedCleanup] = ownedCleanups;
        if (!ownedCleanup) throw new Error("Startup must hand its cleanup to the host.");
        const cleanup = await Effect.runPromise(Effect.result(ownedCleanup));
        if (stage === "register") {
          if (cleanup._tag !== "Failure") throw new Error("The owned cleanup must fail.");
          expect(cleanup.failure.message).toContain("cleanup failure during startup");
        } else {
          expect(cleanup._tag).toBe("Success");
        }
        expect(discardCount).toBe(stage === "forward" ? 0 : 1);
        expect(releaseCount).toBe(stage === "forward" ? 1 : 0);
        expect(exits).toEqual([]);
        if (stage === "spawn") {
          expect(existsSync(runtimePidPath)).toBe(false);
        } else {
          const pid = Number(await readFile(runtimePidPath, "utf8"));
          await waitFor(() => !processIsAlive(pid));
        }
        await expect(
          Effect.runPromise(
            codexAppServer.request({
              runtimeId: "runtime-startup-failure",
              method: "thread/loaded/list",
              params: {},
            }),
          ),
        ).rejects.toThrow("Codex app-server transport not found");
      } finally {
        await removeTestDirectory(root);
      }
    },
  );
  test("starts one shared app-server in the launch directory without workspace MCP values", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-"));
    const runtimePidPath = join(root, "runtime.pid");
    let handle: RuntimeHandle | null = null;
    let runtimeStopped = false;
    const exits: string[] = [];
    const waitForRuntimeExit = async (): Promise<void> => {
      if (!existsSync(runtimePidPath)) {
        return;
      }
      const runtimePid = Number(await readFile(runtimePidPath, "utf8"));
      if (Number.isInteger(runtimePid) && runtimePid > 0) {
        await waitFor(() => !processIsAlive(runtimePid), 2_000);
      }
    };
    try {
      const launchDirectory = await realpath(await mkdtemp(join(root, "home-")));
      const capturePath = join(root, "capture.json");
      const codexBinary = await writeCodex(root, { runtimePidPath });
      const codexAppServer = createTransportRegistry();
      const starter = createStarter({
        systemCommands: stubCommands(),
        codexAppServer,
        toolDiscovery: stubTools({ codex: codexBinary }),
        launchDirectory,
        // A host started from a workspace terminal can inherit workspace MCP values.
        readEnv: () => ({
          ...process.env,
          CODEX_CAPTURE_PATH: capturePath,
          ODT_WORKSPACE_ID: "inherited-workspace",
          ODT_HOST_URL: "http://127.0.0.1:14327",
          ODT_HOST_TOKEN: "inherited-token",
          ODT_FORBID_WORKSPACE_ID_INPUT: "true",
          ODT_ALLOWED_TOOLS: "odt_read_task",
        }),
        clientVersion: "0.3.1-test",
        requestTimeoutMs: 4000,
        now: () => new Date("2026-05-10T10:00:00.000Z"),
        runtimeId: () => "runtime-1",
      });
      handle = await Effect.runPromise(starter.startRuntime(codexStartInput(codexBinary, exits)));
      await waitFor(() => existsSync(runtimePidPath));
      expect(handle.runtime).toEqual({
        kind: "codex",
        runtimeId: "runtime-1",
        runtimeRoute: {
          type: "stdio",
          identity: "runtime-1",
        },
        startedAt: "2026-05-10T10:00:00.000Z",
        descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
      });
      expect(handle.configuredExecutablePath).toBe(codexBinary);
      expect(handle.effectiveExecutablePath).toBe(codexBinary);
      await expect(
        Effect.runPromise(
          codexAppServer.request({
            runtimeId: "runtime-1",
            method: "thread/loaded/list",
            params: { cursor: null },
          }),
        ),
      ).resolves.toEqual({ data: [], nextCursor: null });
      const capture = JSON.parse(await readFile(capturePath, "utf8"));
      expect(capture.env).toEqual({});
      expect(capture.cwd).toBe(launchDirectory);
      expect(capture.initializeVersion).toBe("0.3.1-test");
      expect(capture.args).toEqual(["app-server"]);
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
      runtimeStopped = true;
      await waitForRuntimeExit();
      expect(exits).toEqual([]);
      await expect(
        Effect.runPromise(
          codexAppServer.request({
            runtimeId: "runtime-1",
            method: "thread/loaded/list",
            params: {},
          }),
        ),
      ).rejects.toThrow("Codex app-server transport not found for runtime runtime-1");
    } finally {
      if (handle !== null && !runtimeStopped) {
        await Effect.runPromise(handle.stop());
        await waitForRuntimeExit();
      }
      await removeTestDirectory(root);
    }
  });

  test("reports an unexpected app-server exit once after startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-crash-"));
    const runtimePidPath = join(root, "runtime.pid");
    const exits: string[] = [];
    try {
      const codexBinary = await writeCodex(root, { runtimePidPath });
      const codexAppServer = createTransportRegistry();
      const starter = createStarter({
        systemCommands: stubCommands(),
        codexAppServer,
        toolDiscovery: stubTools({ codex: codexBinary }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-crash",
      });
      const handle = await Effect.runPromise(
        starter.startRuntime(codexStartInput(codexBinary, exits)),
      );
      await waitFor(() => existsSync(runtimePidPath));
      const pid = Number(await readFile(runtimePidPath, "utf8"));

      process.kill(pid, "SIGKILL");
      await waitFor(() => exits.length > 0, 2_000);
      // A later stop shares the finished cleanup and must not report a second exit.
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();

      expect(exits).toHaveLength(1);
      // Windows has no signals: a killed process exits with code 1.
      const exitDescription = process.platform === "win32" ? "with code 1" : "from signal SIGKILL";
      expect(exits[0]).toStartWith(
        `Codex app-server closed: process exited ${exitDescription} for runtime runtime-crash`,
      );
      await expect(
        Effect.runPromise(
          codexAppServer.request({
            runtimeId: "runtime-crash",
            method: "thread/loaded/list",
            params: {},
          }),
        ),
      ).rejects.toThrow("Codex app-server transport not found");
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("stops the Codex app-server process tree including descendants", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-tree-"));
    let childPid: number | null = null;
    try {
      const repo = join(root, "repo");
      const childPidPath = join(root, "child.pid");
      await mkdir(repo);
      const codexBinary = await writeCodex(root, { childPidPath });
      const codexAppServer = createTransportRegistry();
      const starter = createStarter({
        systemCommands: stubCommands(),
        codexAppServer,
        toolDiscovery: stubTools({ codex: codexBinary }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-tree",
      });

      const handle = await Effect.runPromise(starter.startRuntime(codexStartInput(codexBinary)));
      await waitFor(() => existsSync(childPidPath));
      childPid = Number(await readFile(childPidPath, "utf8"));
      expect(processIsAlive(childPid)).toBe(true);

      await Effect.runPromise(handle.stop());
      const stoppedPid = childPid;
      await waitFor(() => !processIsAlive(stoppedPid));
    } finally {
      if (childPid !== null && processIsAlive(childPid)) {
        process.kill(childPid, "SIGKILL");
      }
      await removeTestDirectory(root);
    }
  });

  test("reports Codex process exit details during startup initialization", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-startup-exit-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const codexBinary = await writeCodex(root, {
        exitBeforeInitialize: { code: 42, stderr: "codex exploded before initialize" },
      });
      const codexAppServer = createTransportRegistry();
      const starter = createStarter({
        systemCommands: stubCommands(),
        codexAppServer,
        toolDiscovery: stubTools({ codex: codexBinary }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-startup-exit",
      });

      await expect(
        Effect.runPromise(starter.startRuntime(codexStartInput(codexBinary))),
      ).rejects.toThrow(
        // Windows can deliver the stdout close before the exit event wins the 25 ms race.
        /Codex app-server (?:closed: process exited with code 42|stdout closed unexpectedly) for runtime runtime-startup-exit: codex exploded before initialize/s,
      );
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("keeps process-tree cleanup failures visible while unregistering transport", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-cleanup-failure-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const codexBinary = await writeCodex(root);
      const codexAppServer = createTransportRegistry();
      const starter = createStarter({
        systemCommands: stubCommands(),
        codexAppServer,
        toolDiscovery: stubTools({ codex: codexBinary }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-cleanup-failure",
        processTreeTerminator: () =>
          Effect.fail(
            new HostOperationError({
              operation: "test.processTreeTerminator",
              message: "process tree stayed alive",
            }),
          ),
      });

      const handle = await Effect.runPromise(starter.startRuntime(codexStartInput(codexBinary)));

      await expect(Effect.runPromise(handle.stop())).rejects.toThrow(
        "process tree: process tree stayed alive",
      );
      await expect(
        Effect.runPromise(
          codexAppServer.request({
            runtimeId: "runtime-cleanup-failure",
            method: "thread/loaded/list",
            params: {},
          }),
        ),
      ).rejects.toThrow("Codex app-server transport not found");
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("rejects pending Codex transport requests before waiting on process-tree cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-transport-first-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const runtimeId = "runtime-transport-first";
      const codexBinary = await writeCodex(root, {
        hangRequestMethods: ["thread/loaded/list"],
      });
      const codexAppServer = createTransportRegistry();
      let pendingRequestSettled = false;
      let markProcessCleanupStarted: () => void = () => undefined;
      let releaseProcessCleanup: () => void = () => undefined;
      const processCleanupStarted = new Promise<void>((resolve) => {
        markProcessCleanupStarted = resolve;
      });
      const processCleanupGate = new Promise<void>((resolve) => {
        releaseProcessCleanup = resolve;
      });

      const starter = createStarter({
        codexAppServer,
        readEnv: () => ({ ...process.env, PATH: `${root}:${process.env.PATH ?? ""}` }),
        processTreeTerminator: () =>
          Effect.gen(function* () {
            markProcessCleanupStarted();
            yield* Effect.promise(() => processCleanupGate);
            return yield* Effect.fail(
              new HostOperationError({
                operation: "process-tree.stop",
                message: "process tree stayed alive",
              }),
            );
          }),
        requestTimeoutMs: 4_000,
        runtimeId: () => runtimeId,
        stopTimeoutMs: 25,
        toolDiscovery: stubTools({ codex: codexBinary }),
      });

      const handle = await Effect.runPromise(starter.startRuntime(codexStartInput(codexBinary)));

      const requestPromise = Effect.runPromise(
        codexAppServer.request({
          runtimeId,
          method: "thread/loaded/list",
          params: {},
        }),
      ).catch((error) => {
        pendingRequestSettled = true;
        return error;
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(pendingRequestSettled).toBe(false);

      const stopping = Effect.runPromise(handle.stop());
      await processCleanupStarted;
      const requestError = await requestPromise;
      releaseProcessCleanup();
      expect(requestError).toBeInstanceOf(Error);
      await expect(stopping).rejects.toThrow("process tree: process tree stayed alive");
    } finally {
      await removeTestDirectory(root);
    }
  });

  test("starts a Windows PATH-discovered cmd Codex app-server runtime", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "odt-codex-path-starter-"));
    const originalCapturePath = process.env.CODEX_CAPTURE_PATH;
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const capturePath = join(root, "capture.json");
      process.env.CODEX_CAPTURE_PATH = capturePath;
      const codexBinary = await writeCodex(root);
      const codexAppServer = createTransportRegistry();
      const pathWithFakeRuntime = `${root};${process.env.PATH ?? ""}`;
      const localAppData = join(root, "local-app-data");
      const starter = createStarter({
        systemCommands: createSystemCommandRunner({
          readEnv: () => ({
            ...process.env,
            LOCALAPPDATA: localAppData,
            PATH: pathWithFakeRuntime,
            PATHEXT: ".CMD",
          }),
          platform: "win32",
        }),
        readEnv: () => ({
          ...process.env,
          LOCALAPPDATA: localAppData,
          PATH: pathWithFakeRuntime,
          PATHEXT: ".CMD",
        }),
        codexAppServer,
        clientVersion: "0.3.1-test",
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-path",
      });

      expect(codexBinary.endsWith(".cmd")).toBe(true);
      const handle = await Effect.runPromise(starter.startRuntime(codexStartInput(codexBinary)));

      expect(handle.runtime.runtimeId).toBe("runtime-path");
      const capture = JSON.parse(await readFile(capturePath, "utf8"));
      expect(capture.args).toContain("app-server");
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
    } finally {
      if (originalCapturePath === undefined) {
        delete process.env.CODEX_CAPTURE_PATH;
      } else {
        process.env.CODEX_CAPTURE_PATH = originalCapturePath;
      }
      await removeTestDirectory(root);
    }
  });

  test("prepares live observation before transport events and registers before forwarding", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-events-"));
    try {
      const repo = join(root, "repo");
      await mkdir(repo);
      const codexBinary = await writeCodex(root, { emitStreamEvents: true });
      const codexAppServer = createTransportRegistry();
      const events: unknown[] = [];
      const order: string[] = [];
      const liveSessionLifecycle = {
        registerRuntimeAdapter: () =>
          Effect.sync(() => {
            order.push("register");
          }),
        releaseRuntime: () =>
          Effect.sync(() => {
            order.push("release");
            return [];
          }),
        createRuntimeRegistration: (binding) =>
          new AgentSessionLiveRegistration(binding, (mutation) =>
            mutation.pipe(Effect.map((result) => result.value)),
          ),
      } satisfies RuntimeLiveSessionLifecyclePort;
      const starter = createStarter({
        systemCommands: stubCommands(),
        codexAppServer,
        toolDiscovery: stubTools({ codex: codexBinary }),
        liveSessionLifecycle,
        prepareLiveSessionAdapter: (runtime) =>
          Effect.sync(() => {
            order.push("prepare");
            return {
              adapter: createAgentSessionRuntimeAdapterTestDouble(
                {
                  runtimeId: runtime.runtimeId,
                  runtimeKind: "codex",
                },
                {},
              ),
              emitRuntimeEvent: (event: CodexAppServerStreamEvent) => {
                order.push("event");
                events.push(event);
              },
              startForwarding: () =>
                Effect.sync(() => {
                  order.push("forward");
                }),
              discard: () => Effect.void,
            };
          }),
        requestTimeoutMs: 4000,
        runtimeId: () => "runtime-events",
      });
      const handle = await Effect.runPromise(starter.startRuntime(codexStartInput(codexBinary)));
      await waitForEvents(events, 2);
      expect(order.indexOf("prepare")).toBeLessThan(order.indexOf("event"));
      expect(order.indexOf("register")).toBeLessThan(order.indexOf("forward"));
      expect(events).toEqual([
        {
          runtimeId: "runtime-events",
          kind: "notification",
          receivedAt: expect.any(String),
          message: {
            method: "thread/status/changed",
            params: { threadId: "thread-1", status: { type: "idle" } },
          },
        },
        {
          runtimeId: "runtime-events",
          kind: "server_request",
          receivedAt: expect.any(String),
          message: {
            id: 99,
            method: "execCommandApproval",
            params: {
              conversationId: "thread-1",
              callId: "call-1",
              approvalId: null,
              command: ["true"],
              cwd: "/repo",
              reason: null,
              parsedCmd: [],
            },
          },
        },
      ]);
      await Effect.runPromise(handle.stop());
      expect(order).toContain("release");
    } finally {
      await removeTestDirectory(root);
    }
  });

  test.each(["child close", "fatal transport"])(
    "releases the adapter when %s occurs while registration settles",
    async (failureKind) => {
      const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-registration-close-"));
      const runtimePidPath = join(root, "runtime.pid");
      const fatalMessagePath = join(root, "fatal.json");
      let runtimePid: number | null = null;
      let finishRegistration = (): void => {};
      let markRegistrationStarted = (): void => {};
      const registrationGate = new Promise<void>((resolve) => {
        finishRegistration = resolve;
      });
      const registrationStarted = new Promise<void>((resolve) => {
        markRegistrationStarted = resolve;
      });
      const registeredRuntimeIds = new Set<string>();
      let discardCount = 0;
      let releaseCount = 0;

      try {
        const repo = join(root, "repo");
        await mkdir(repo);
        const codexBinary = await writeCodex(root, { runtimePidPath, fatalMessagePath });
        const codexAppServer = createTransportRegistry();
        const liveSessionLifecycle = {
          registerRuntimeAdapter: (adapter) =>
            Effect.promise(async () => {
              registeredRuntimeIds.add(adapter.binding.runtimeId);
              markRegistrationStarted();
              await registrationGate;
            }),
          releaseRuntime: (releasedRuntimeId: string) =>
            Effect.sync(() => {
              releaseCount += 1;
              registeredRuntimeIds.delete(releasedRuntimeId);
              return [];
            }),
          createRuntimeRegistration: (binding) =>
            new AgentSessionLiveRegistration(binding, (mutation) =>
              mutation.pipe(Effect.map((result) => result.value)),
            ),
        } satisfies RuntimeLiveSessionLifecyclePort;
        const starter = createStarter({
          systemCommands: stubCommands(),
          codexAppServer,
          toolDiscovery: stubTools({ codex: codexBinary }),
          liveSessionLifecycle,
          prepareLiveSessionAdapter: (runtime) =>
            Effect.succeed({
              adapter: createAgentSessionRuntimeAdapterTestDouble(
                {
                  runtimeId: runtime.runtimeId,
                  runtimeKind: runtime.kind,
                },
                {},
              ),
              emitRuntimeEvent: () => {},
              startForwarding: () =>
                Effect.fail(
                  new HostOperationError({
                    operation: "test.startForwarding",
                    message: "Forwarding cannot start after the runtime closes.",
                  }),
                ),
              discard: () =>
                Effect.sync(() => {
                  discardCount += 1;
                }),
            }),
          requestTimeoutMs: 4_000,
          runtimeId: () => "runtime-registration-close",
        });

        const startup = Effect.runPromise(
          Effect.flip(starter.startRuntime(codexStartInput(codexBinary))),
        );
        await registrationStarted;
        await waitFor(() => existsSync(runtimePidPath));
        const pid = Number(await readFile(runtimePidPath, "utf8"));
        runtimePid = pid;
        if (failureKind === "child close") {
          process.kill(pid, "SIGTERM");
          await waitFor(() => !processIsAlive(pid), 2_000);
        } else {
          await writeFile(fatalMessagePath, JSON.stringify({ id: 999, result: {} }));
          // Wait for the existing transport to reject work before registration settles.
          await waitFor(async () => {
            const result = await Effect.runPromise(
              Effect.result(
                codexAppServer.request({
                  runtimeId: "runtime-registration-close",
                  method: "thread/loaded/list",
                  params: {},
                }),
              ),
            );
            return result._tag === "Failure";
          });
        }
        await expect(
          Effect.runPromise(
            codexAppServer.request({
              runtimeId: "runtime-registration-close",
              method: "thread/loaded/list",
              params: { cursor: null },
            }),
          ),
        ).rejects.toThrow();

        finishRegistration();

        const failure = await startup;
        if (failureKind === "fatal transport")
          expect(failure.message).toContain("unexpected id 999");
        expect(releaseCount).toBe(1);
        expect(discardCount).toBe(0);
        expect(registeredRuntimeIds).toEqual(new Set());
        await waitFor(() => !processIsAlive(pid));
        await expect(
          Effect.runPromise(
            codexAppServer.request({
              runtimeId: "runtime-registration-close",
              method: "thread/loaded/list",
              params: {},
            }),
          ),
        ).rejects.toThrow("Codex app-server transport not found");
      } finally {
        finishRegistration();
        if (runtimePid !== null && processIsAlive(runtimePid)) {
          process.kill(runtimePid, "SIGKILL");
        }
        await removeTestDirectory(root);
      }
    },
  );
});
