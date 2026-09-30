import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ODT_MCP_TOOL_NAMES, RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError, type HostOperationErrorAggregate } from "../../effect/host-errors";
import { terminateProcessTree } from "../../infrastructure/process/process-tree";
import { AgentSessionLiveRegistration } from "../../ports/agent-session-live-adapter-port";
import type { CodexAppServerStreamEvent } from "../../ports/codex-app-server-port";
import type { RuntimeLiveSessionLifecyclePort } from "../../ports/runtime-live-session-lifecycle-port";
import type { RuntimeWorkspaceHandle } from "../../ports/runtime-registry-port";
import { createAgentSessionRuntimeAdapterTestDouble } from "../../test-support/service-test-doubles";
import { removeTestDirectory } from "../../test-support/temp-directory";
import { createSystemCommandRunner } from "../system/system-command-runner";
import { createCodexAppServerTransportRegistry as createTransportRegistry } from "./codex-app-server-transport-registry";
import {
  createStarter,
  processIsAlive,
  stubCommands,
  stubTools,
  tomlString,
  waitFor,
  waitForEvents,
  writeCodex,
} from "./codex-workspace-runtime-starter.test-support";

describe("createCodexWorkspaceRuntimeStarter", () => {
  test("fails fast when the MCP bridge connection is not configured", async () => {
    const starter = createStarter({
      systemCommands: stubCommands(),
      codexAppServer: createTransportRegistry(),
    });
    await expect(
      Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: "/repo",
          workingDirectory: "/repo",
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      ),
    ).rejects.toThrow("Codex workspace startup requires an MCP host bridge connection.");
  });

  test.each(["spawn", "initialize", "register", "forward"])(
    "cleans up startup failure at %s",
    async (stage) => {
      const root = await mkdtemp(join(tmpdir(), "odt-codex-startup-failure-"));
      const runtimePidPath = join(root, "runtime.pid");
      let discardCount = 0;
      let releaseCount = 0;
      const failures: HostOperationErrorAggregate[] = [];
      const startupFailure = new HostOperationError({
        operation: "test.startup",
        message: `${stage} failed`,
      });
      try {
        const binary = await writeCodex(root, {
          runtimePidPath,
          hangRequestMethods: stage === "initialize" ? ["initialize"] : [],
        });
        const codexAppServer = createTransportRegistry();
        const starter = createStarter({
          codexAppServer,
          toolDiscovery: stubTools({
            codex: stage === "spawn" ? join(root, "missing") : binary,
          }),
          runtimeId: () => "runtime-startup-failure",
          requestTimeoutMs: stage === "initialize" ? 1_000 : 4_000,
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
                  repoPath: root,
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
              Effect.zipRight(
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
        const failure = await Effect.runPromise(
          Effect.flip(
            starter.startWorkspaceRuntime({
              runtimeKind: "codex",
              repoPath: root,
              workingDirectory: root,
              descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
            }),
          ),
        );
        if (stage === "spawn") expect(failure.message).toContain("no valid pid");
        if (stage === "initialize")
          expect(failure.message).toContain(
            "Timed out waiting for Codex app-server request initialize",
          );
        if (stage === "register" || stage === "forward")
          expect(failure.message).toContain(startupFailure.message);
        if (stage === "register") {
          expect(failure.cause).toBe(startupFailure);
          expect(failure.message).toContain("cleanup failure during startup");
        }
        expect(discardCount).toBe(stage === "forward" ? 0 : 1);
        expect(releaseCount).toBe(stage === "forward" ? 1 : 0);
        expect(failures).toEqual([]);
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
  test("starts a Codex app-server runtime, registers transport, and stops it", async () => {
    const root = await mkdtemp(join(tmpdir(), "odt-codex-starter-"));
    const originalCapturePath = process.env.CODEX_CAPTURE_PATH;
    const runtimePidPath = join(root, "runtime.pid");
    let handle: RuntimeWorkspaceHandle | null = null;
    let runtimeStopped = false;
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
      const repo = process.cwd();
      const capturePath = join(root, "capture.json");
      process.env.CODEX_CAPTURE_PATH = capturePath;
      const codexBinary = await writeCodex(root, { runtimePidPath });
      const codexAppServer = createTransportRegistry();
      const starter = createStarter({
        systemCommands: stubCommands(),
        codexAppServer,
        toolDiscovery: stubTools({ codex: codexBinary }),
        clientVersion: "0.3.1-test",
        resolveMcpBridgeConnection: () =>
          Effect.tryPromise({
            try: async () => ({
              workspaceId: "repo",
              hostUrl: "http://127.0.0.1:14327",
              hostToken: "token-1",
            }),
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause,
              }),
          }),
        requestTimeoutMs: 4000,
        now: () => new Date("2026-05-10T10:00:00.000Z"),
        runtimeId: () => "runtime-1",
      });
      handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );
      await waitFor(() => existsSync(runtimePidPath));
      expect(handle.runtime).toMatchObject({
        kind: "codex",
        runtimeId: "runtime-1",
        repoPath: repo,
        role: "workspace",
        workingDirectory: repo,
        runtimeRoute: {
          type: "stdio",
          identity: "runtime-1",
        },
        startedAt: "2026-05-10T10:00:00.000Z",
      });
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
      expect(capture.env).toMatchObject({
        ODT_WORKSPACE_ID: "repo",
        ODT_HOST_URL: "http://127.0.0.1:14327",
        ODT_HOST_TOKEN: "token-1",
        ODT_FORBID_WORKSPACE_ID_INPUT: "true",
      });
      expect(capture.env.ODT_ALLOWED_TOOLS).toBe(ODT_MCP_TOOL_NAMES.join(","));
      expect(capture.initializeVersion).toBe("0.3.1-test");
      expect(capture.args).toEqual(
        expect.arrayContaining([
          "--config",
          `mcp_servers.openducktor.command=${tomlString(process.execPath)}`,
          "--config",
          expect.stringContaining("mcp_servers.openducktor.args="),
          "--config",
          "mcp_servers.openducktor.env_vars=['ODT_WORKSPACE_ID', 'ODT_HOST_URL', 'ODT_HOST_TOKEN', 'ODT_FORBID_WORKSPACE_ID_INPUT', 'ODT_ALLOWED_TOOLS']",
          "--config",
          "mcp_servers.openducktor.default_tools_approval_mode='prompt'",
          "--config",
          "mcp_servers.openducktor.enabled=true",
          "--config",
          "mcp_servers.openducktor.required=true",
        ]),
      );
      expect(capture.args).not.toContain("mcp_servers.openducktor.env.ODT_WORKSPACE_ID='repo'");
      expect(capture.args).not.toContain(
        "mcp_servers.openducktor.env.ODT_HOST_URL='http://127.0.0.1:14327'",
      );
      expect(capture.args).not.toContain("mcp_servers.openducktor.env.ODT_HOST_TOKEN='token-1'");
      expect(capture.args).not.toContain(
        "mcp_servers.openducktor.env.ODT_FORBID_WORKSPACE_ID_INPUT='true'",
      );
      expect(capture.args).toContain("app-server");
      await expect(Effect.runPromise(handle.stop())).resolves.toBeUndefined();
      runtimeStopped = true;
      await waitForRuntimeExit();
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
      if (originalCapturePath === undefined) {
        delete process.env.CODEX_CAPTURE_PATH;
      } else {
        process.env.CODEX_CAPTURE_PATH = originalCapturePath;
      }
      if (handle !== null && !runtimeStopped) {
        await Effect.runPromise(handle.stop());
        await waitForRuntimeExit();
      }
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
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-tree",
      });

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );
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
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-startup-exit",
      });

      await expect(
        Effect.runPromise(
          starter.startWorkspaceRuntime({
            runtimeKind: "codex",
            repoPath: repo,
            workingDirectory: repo,
            descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
          }),
        ),
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
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
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

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );

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
        processEnv: { ...process.env, PATH: `${root}:${process.env.PATH ?? ""}` },
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
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:4123",
            hostToken: "bridge-token",
          }),
      });

      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );

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
          env: {
            ...process.env,
            LOCALAPPDATA: localAppData,
            PATH: pathWithFakeRuntime,
            PATHEXT: ".CMD",
          },
          platform: "win32",
        }),
        processEnv: {
          ...process.env,
          LOCALAPPDATA: localAppData,
          PATH: pathWithFakeRuntime,
          PATHEXT: ".CMD",
        },
        codexAppServer,
        clientVersion: "0.3.1-test",
        resolveMcpBridgeConnection: () =>
          Effect.succeed({
            workspaceId: "repo",
            hostUrl: "http://127.0.0.1:14327",
            hostToken: "token-1",
          }),
        requestTimeoutMs: 4_000,
        runtimeId: () => "runtime-path",
      });

      expect(codexBinary.endsWith(".cmd")).toBe(true);
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );

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
                  repoPath: runtime.repoPath,
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
        resolveMcpBridgeConnection: () =>
          Effect.tryPromise({
            try: async () => {
              return {
                workspaceId: "repo",
                hostUrl: "http://127.0.0.1:14327",
                hostToken: "token-1",
              };
            },
            catch: (cause) =>
              new HostOperationError({
                operation: "test.effect",
                message: cause instanceof Error ? cause.message : String(cause),
                cause: cause,
              }),
          }),
        requestTimeoutMs: 4000,
        runtimeId: () => "runtime-events",
      });
      const handle = await Effect.runPromise(
        starter.startWorkspaceRuntime({
          runtimeKind: "codex",
          repoPath: repo,
          workingDirectory: repo,
          descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
        }),
      );
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
                  repoPath: runtime.repoPath,
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
          resolveMcpBridgeConnection: () =>
            Effect.succeed({
              workspaceId: "repo",
              hostUrl: "http://127.0.0.1:14327",
              hostToken: "token-1",
            }),
          requestTimeoutMs: 4_000,
          runtimeId: () => "runtime-registration-close",
        });

        const startup = Effect.runPromise(
          Effect.flip(
            starter.startWorkspaceRuntime({
              runtimeKind: "codex",
              repoPath: repo,
              workingDirectory: repo,
              descriptor: RUNTIME_DESCRIPTORS_BY_KIND.codex,
            }),
          ),
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
              Effect.either(
                codexAppServer.request({
                  runtimeId: "runtime-registration-close",
                  method: "thread/loaded/list",
                  params: {},
                }),
              ),
            );
            return result._tag === "Left";
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
