import { describe, expect, mock, spyOn, test } from "bun:test";
import * as realClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import { workspaceSessionSchema } from "@openducktor/contracts";
import { initialSpeedState, type AgentEvent, type AgentModelSelection } from "@openducktor/core";
import { Effect } from "effect";
import { attachImportedWorkspaceSession } from "../../application/workspaces/workspace-session-speed-persistence";
import { createClaudeLiveSessionState } from "../agent-sessions/claude-live-session-state";
import { createSqliteTaskStoreHarness } from "../sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../sqlite/sqlite-workspace-session-store";
import { createArtifactRuntimeDistribution } from "../runtimes/runtime-distribution";
import { claudeSubagentEventSession } from "./claude-agent-sdk-event-session";
import { handleClaudeSdkMessage } from "./claude-agent-sdk-events";
import { createEventTestSession } from "./claude-agent-sdk-events.test-support";
import { createClaudeQueryFixture } from "./claude-agent-sdk-session-io.test-support";
import { sendClaudeUserMessage } from "./claude-agent-sdk-session-io";
import { createClaudeAgentSdkSessionStore } from "./claude-agent-sdk-session-store";
import { claudeSdkMessageFixture } from "./claude-agent-sdk-test-messages";
import { ClaudeSessionSpeedControl } from "./claude-session-speed-control";
import type { CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";

const deferred = <Value>() => {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const createToolDiscovery = (): CreateClaudeAgentSdkServiceInput["toolDiscovery"] => ({
  discoverTool: () => Effect.die("unused"),
  resolveTool: () => Effect.die("unused"),
  resolveToolPath: () => Effect.succeed(process.execPath),
  validateToolPath: () => Effect.die("unused"),
});

describe("createClaudeAgentSdkSession", () => {
  test.each([
    ...(
      [
        { early: true, savedSpeed: "standard", reportSpeed: "off", expectedSpeed: "standard" },
        { early: false, savedSpeed: "standard", reportSpeed: "off", expectedSpeed: "standard" },
        { early: false, savedSpeed: "fast", reportSpeed: "on", expectedSpeed: "standard" },
        { early: false, savedSpeed: null, reportSpeed: "off", expectedSpeed: "standard" },
      ] as const
    ).map((path) => ({
      ...path,
      nativeModel: "claude-sonnet-5-5",
      effort: undefined,
      restricted: false,
    })),
    ...[true, false].flatMap((early) =>
      (["high", "max", null, undefined] as const).map((effort) => ({
        early,
        savedSpeed: "standard",
        reportSpeed: "off" as const,
        expectedSpeed: "standard",
        nativeModel: "opus",
        effort,
        restricted: false,
      })),
    ),
    ...[true, false].flatMap((early) =>
      ["opus", "claude-sonnet-5-5"].map((nativeModel) => ({
        early,
        savedSpeed: null,
        reportSpeed: "off" as const,
        expectedSpeed: null,
        nativeModel,
        effort: "high" as const,
        restricted: true,
      })),
    ),
  ])(
    "keeps native model and effort with early=$early, model=$nativeModel, effort=$effort, saved speed=$savedSpeed",
    async ({ early, savedSpeed, reportSpeed, expectedSpeed, nativeModel, effort, restricted }) => {
      const repoPath = process.cwd();
      const scope = { repoPath, workspaceId: "fairnest" };
      const database = await createSqliteTaskStoreHarness({ repoPath });
      const store = createSqliteWorkspaceSessionStore(database.contextProvider);
      const sessionStore = createClaudeAgentSdkSessionStore();
      const reportReady = deferred<void>();
      const reportHandled = deferred<void>();
      const streamFinished = deferred<void>();
      const savedModel = { providerId: "claude", modelId: "opus", variant: "low" };
      const setModel = mock(async () => {});
      const flags = mock(async () => {});
      const published: string[] = [];
      const sdkQuery = createClaudeQueryFixture({
        close: () => streamFinished.resolve(),
        setModel,
        applyFlagSettings: flags,
        supportedModels: async () => [
          {
            value: "sonnet",
            resolvedModel: "claude-sonnet-5-5",
            displayName: "Sonnet",
            description: "Sonnet",
            supportsFastMode: false,
          },
        ],
        initializationResult: async () => {
          if (early) await reportHandled.promise;
          const report: Awaited<ReturnType<realClaudeSdk.Query["initializationResult"]>> = {
            account: {},
            agents: [],
            available_output_styles: [],
            commands: [],
            models: [],
            output_style: "default",
          };
          if (savedSpeed !== null) report.fast_mode_state = reportSpeed;
          if (restricted) {
            report.fast_mode_state = reportSpeed;
            report.fast_mode_disabled_reason = "extra_usage_disabled";
          }
          return report;
        },
        mcpServerStatus: async () => [{ name: "openducktor", status: "connected" }],
        async *[Symbol.asyncIterator]() {
          await reportReady.promise;
          const report = claudeSdkMessageFixture({
            type: "system",
            subtype: "init",
            model: nativeModel,
            fast_mode_state: reportSpeed,
          });
          if (effort !== undefined) report.effort = effort;
          if (restricted) report.fast_mode_disabled_reason = "extra_usage_disabled";
          yield report;
          reportHandled.resolve();
          await streamFinished.promise;
        },
      });
      const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => sdkQuery);
      try {
        const saved = await Effect.runPromise(
          store.create({
            ...scope,
            session: workspaceSessionSchema.parse({
              id: "retained",
              runtimeKind: "claude",
              externalSessionId: "session-retained",
              executionTarget: { kind: "local_repo_root", workingDirectory: repoPath },
              roleSnapshot: null,
              selectedModel: { ...savedModel, runtimeKind: "claude" },
              speed: savedSpeed,
              generatedTitle: null,
              manualTitle: null,
              createdAt: 0,
              updatedAt: 0,
              archivedAt: null,
            }),
          }),
        );
        if (early) reportReady.resolve();
        const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
        await createClaudeAgentSdkSession({
          emit: () => {},
          input: {
            repoPath,
            workingDirectory: repoPath,
            runtimeKind: "claude",
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "repository" },
            systemPrompt: "",
            model: savedModel,
            speed: savedSpeed,
          },
          initialTodos: [],
          now: () => "2026-10-09T00:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: scope.workspaceId,
              hostUrl: "http://127.0.0.1:1",
              hostToken: "test-token",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput: {
            claudeExecutablePath: process.execPath,
            launchPolicy: { resolve: () => Effect.succeed({}) },
            onBackgroundFailure: () => Effect.void,
            resolveMcpBridgeConnection: () => Effect.die("unused"),
            runtimeDistribution: createArtifactRuntimeDistribution({
              mcpLauncher: { kind: "executable", executablePath: process.execPath },
            }),
            sessionStore,
            toolDiscovery: createToolDiscovery(),
          },
          sessionInput: {
            externalSessionId: "session-retained",
            options: { resume: "session-retained" },
            preserveNativeSettings: true,
            startedMessage: "Resumed session",
          },
          sessionStore,
          recordSpeedChoice: async (_ref, speed, isCurrent, model) => {
            if (!isCurrent()) throw new Error("Session lost its owner");
            const updated = await Effect.runPromise(
              model
                ? store.setSelectedModel({
                    ...scope,
                    sessionId: saved.id,
                    selectedModel: { ...model, runtimeKind: "claude" },
                    speed,
                  })
                : store.setSpeed({ ...scope, sessionId: saved.id, speed }),
            );
            return async () => {
              published.push(updated.selectedModel?.modelId ?? "");
            };
          },
        });
        if (!early) {
          reportReady.resolve();
          await reportHandled.promise;
        }
        const session = sessionStore.get("session-retained")!;
        const expectedModel: AgentModelSelection = { ...savedModel, modelId: nativeModel };
        if (effort === null) delete expectedModel.variant;
        else if (effort !== undefined) expectedModel.variant = effort;
        expect(session.model).toEqual(expectedModel);
        expect(session.summary.speed).toMatchObject({
          choice: expectedSpeed,
          synchronization: expectedSpeed === null ? "unapplied" : "confirmed",
        });
        const record = await Effect.runPromise(store.get({ ...scope, sessionId: saved.id }));
        expect(record.selectedModel).toEqual({ ...expectedModel, runtimeKind: "claude" });
        expect(record.speed).toBe(expectedSpeed);
        if (nativeModel !== savedModel.modelId || effort !== undefined)
          expect(published.at(-1)).toBe(nativeModel);
        else expect(published).toEqual([]);
        expect(setModel).not.toHaveBeenCalled();
        if (savedSpeed === "fast") expect(flags).toHaveBeenCalledWith({ fastMode: false });
        let nextModel = nativeModel === savedModel.modelId ? expectedModel : savedModel;
        if (expectedSpeed === null) {
          await expect(session.turnAdmission.run(async () => {})).rejects.toThrow("pending");
          const control = new ClaudeSessionSpeedControl({
            findSession: sessionStore.get,
            requireSession: () => session,
            createSession: () => Effect.die(new Error("Unexpected attachment")),
            emit: () => {},
            now: () => "2026-10-09T00:00:01.000Z",
            onBackgroundFailure: () => Effect.void,
          });
          const ref = { ...session.input, externalSessionId: session.externalSessionId };
          await Effect.runPromise(control.updateSessionSpeed({ ...ref, speed: "standard" }));
          const publish = await session.recordSpeedChoice!("standard");
          await Effect.runPromise(
            control.setSessionSpeedState(ref, initialSpeedState("standard", "confirmed")),
          );
          await publish();
          const updated = await Effect.runPromise(store.get({ ...scope, sessionId: saved.id }));
          expect(updated.selectedModel).toEqual({ ...expectedModel, runtimeKind: "claude" });
          nextModel = updated.selectedModel!;
          flags.mockClear();
        }
        await sendClaudeUserMessage({
          session,
          emit: () => {},
          now: () => "2026-10-09T00:00:01.000Z",
          randomId: () => "00000000-0000-4000-8000-000000000001",
          messageInput: {
            ...session.input,
            externalSessionId: session.externalSessionId,
            model: nextModel,
            parts: [{ kind: "text", text: "Use the selected model" }],
          },
        });
        expect(setModel).toHaveBeenCalledWith(expectedSpeed === null ? nativeModel : "opus");
        if (nativeModel === savedModel.modelId || expectedSpeed === null)
          expect(flags.mock.calls).toEqual([]);
      } finally {
        const session = sessionStore.get("session-retained");
        if (session) sessionStore.close(session);
        reportReady.resolve();
        streamFinished.resolve();
        querySpy.mockRestore();
        await database.cleanup();
      }
    },
  );

  test.each([
    {
      report: { fast_mode_state: "off", fast_mode_disabled_reason: "extra_usage_disabled" },
      choice: null,
    },
    {
      report: { fast_mode_state: "off", fast_mode_disabled_reason: "network_error" },
      choice: null,
    },
    {
      report: { fast_mode_state: "off", fast_mode_disabled_reason: "disabled_by_env" },
      choice: null,
    },
    { report: { fast_mode_state: "on" }, choice: "fast" },
    { report: { fast_mode_state: "cooldown" }, choice: "fast" },
    {
      report: { fast_mode_state: "off", fast_mode_disabled_reason: "preference" },
      choice: "standard",
    },
    { report: { fast_mode_state: "off" }, choice: "standard" },
    { report: {}, choice: null },
  ] as const)(
    "imports only an authoritative speed choice from $report",
    async ({ report, choice }) => {
      const repoPath = process.cwd();
      const scope = { repoPath, workspaceId: "fairnest" };
      const database = await createSqliteTaskStoreHarness({ repoPath });
      const store = createSqliteWorkspaceSessionStore(database.contextProvider);
      const sessionStore = createClaudeAgentSdkSessionStore();
      const live = createClaudeLiveSessionState(
        (ref) => sessionStore.get(ref.externalSessionId)?.model,
      );
      const streamFinished = deferred<void>();
      const sdkQuery = createClaudeQueryFixture({
        close: () => streamFinished.resolve(),
        initializationResult: async () => ({
          account: {},
          agents: [],
          available_output_styles: [],
          commands: [],
          models: [],
          output_style: "default",
          ...report,
        }),
        mcpServerStatus: async () => [{ name: "openducktor", status: "connected" }],
        async *[Symbol.asyncIterator]() {
          await streamFinished.promise;
          yield* [];
        },
      });
      const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => sdkQuery);
      try {
        const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
        const saved = await Effect.runPromise(
          store.create({
            ...scope,
            session: workspaceSessionSchema.parse({
              id: "imported",
              runtimeKind: "claude",
              externalSessionId: "session-imported",
              executionTarget: { kind: "local_repo_root", workingDirectory: repoPath },
              roleSnapshot: null,
              selectedModel: null,
              speed: null,
              generatedTitle: null,
              manualTitle: null,
              createdAt: 0,
              updatedAt: 0,
              archivedAt: null,
            }),
          }),
        );
        const ref = {
          repoPath,
          workingDirectory: repoPath,
          runtimeKind: "claude" as const,
          externalSessionId: "session-imported",
        };
        const publish = mock(() => Effect.void);
        const imported = await Effect.runPromise(
          attachImportedWorkspaceSession(
            {
              metadata: { ...ref, title: null, updatedAt: null },
              selectedModel: null,
              speed: null,
              attach: Effect.promise(async () => {
                const summary = await createClaudeAgentSdkSession({
                  emit: (session, event) => {
                    live.applyEvent(session, event);
                  },
                  input: {
                    ...ref,
                    runtimePolicy: { kind: "claude" },
                    sessionScope: { kind: "repository" },
                    systemPrompt: "",
                    speed: null,
                  },
                  initialTodos: [],
                  now: () => "2026-10-08T00:00:00.000Z",
                  randomId: () => "id",
                  resolvedDependencies: {
                    claudeExecutablePath: process.execPath,
                    mcpBridgeConnection: {
                      workspaceId: scope.workspaceId,
                      hostUrl: "http://127.0.0.1:1",
                      hostToken: "test-token",
                    },
                    mcpCommand: [process.execPath],
                  },
                  runtimeId: "runtime-1",
                  serviceInput: {
                    claudeExecutablePath: process.execPath,
                    launchPolicy: { resolve: () => Effect.succeed({}) },
                    onBackgroundFailure: () => Effect.void,
                    resolveMcpBridgeConnection: () => Effect.die("unused"),
                    runtimeDistribution: createArtifactRuntimeDistribution({
                      mcpLauncher: { kind: "executable", executablePath: process.execPath },
                    }),
                    sessionStore,
                    toolDiscovery: createToolDiscovery(),
                  },
                  sessionInput: {
                    externalSessionId: ref.externalSessionId,
                    options: { resume: ref.externalSessionId },
                    preserveNativeSettings: true,
                    startedMessage: "Imported session",
                  },
                  sessionStore,
                });
                live.applyControlSummary(repoPath, summary);
              }),
            },
            { readSnapshot: (input) => Effect.succeed(live.readSnapshot(input)) },
            ref,
            scope,
            saved,
            store,
            publish,
          ),
        );
        expect(imported.speed).toBe(choice);
        expect((await Effect.runPromise(store.get({ ...scope, sessionId: saved.id }))).speed).toBe(
          choice,
        );
        const session = sessionStore.get(ref.externalSessionId)!;
        expect(session.summary.speed).toMatchObject({
          choice,
          synchronization: choice === null ? "unapplied" : "confirmed",
        });
        expect(session.turnAdmission.isClosed).toBe(choice === null);
        if (
          "fast_mode_disabled_reason" in report &&
          report.fast_mode_disabled_reason !== "preference"
        ) {
          expect(session.summary.speed.availability).toMatchObject({
            status: "blocked",
            reason: { code: report.fast_mode_disabled_reason },
          });
        }
        expect(publish).toHaveBeenCalledTimes(1);
      } finally {
        const session = sessionStore.get("session-imported");
        if (session) sessionStore.close(session);
        streamFinished.resolve();
        querySpy.mockRestore();
        await database.cleanup();
      }
    },
  );

  test("fails a repository session when the workspace-bound OpenDucktor MCP is disconnected", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      mcpServerStatus: async () => [
        { name: "openducktor", status: "failed", error: "bridge unavailable" },
      ],
      return: async () => {
        streamFinished.resolve();
        return { done: true, value: undefined } as const;
      },
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await expect(
        createClaudeAgentSdkSession({
          emit: () => {},
          input: {
            repoPath: process.cwd(),
            runtimeKind: "claude",
            workingDirectory: process.cwd(),
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "repository" },
            systemPrompt: "Help with this repository",
          },
          initialTodos: [],
          now: () => "2026-06-25T20:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: "workspace-1",
              hostUrl: "http://127.0.0.1:1",
              hostToken: "bridge-secret-value",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput,
          sessionInput: {
            externalSessionId: "session-repository",
            options: { sessionId: "session-repository" },
            startedMessage: "Started repository session",
            title: "Repository session",
          },
          sessionStore,
        }),
      ).rejects.toMatchObject({
        operation: "claudeRuntime.requireOpenDucktorMcp",
        message:
          "OpenDucktor MCP server is not connected for repository Claude session 'session-repository': failed (bridge unavailable).",
      });
      expect(sessionStore.get("session-repository")).toBeUndefined();
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test.each([undefined, "auto"] as const)(
    "starts a session with %s mode without a policy notice before Claude reports its mode",
    async (permissionMode) => {
      const streamFinished = deferred<void>();
      const fakeQuery = createClaudeQueryFixture({
        close: () => streamFinished.resolve(),
        initializationResult: async () => ({
          account: {},
          agents: [],
          available_output_styles: [],
          commands: [],
          models: [],
          output_style: "default",
        }),
        async *[Symbol.asyncIterator]() {
          await streamFinished.promise;
          yield* [];
        },
      });
      const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

      try {
        const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
        const events: AgentEvent[] = [];
        const sessionStore = createClaudeAgentSdkSessionStore();
        const serviceInput: CreateClaudeAgentSdkServiceInput = {
          claudeExecutablePath: process.execPath,
          launchPolicy: {
            resolve: () => Effect.succeed({}),
          },
          onBackgroundFailure: () => Effect.void,
          resolveMcpBridgeConnection: () => Effect.die("unused"),
          runtimeDistribution: createArtifactRuntimeDistribution({
            mcpLauncher: { kind: "executable", executablePath: process.execPath },
          }),
          sessionStore,
          toolDiscovery: createToolDiscovery(),
        };

        await expect(
          createClaudeAgentSdkSession({
            emit: (_session, event) => events.push(event),
            input: {
              repoPath: process.cwd(),
              runtimeKind: "claude",
              workingDirectory: process.cwd(),
              runtimePolicy: { kind: "claude" },
              sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
              systemPrompt: "Build",
            },
            initialTodos: [],
            now: () => "2026-06-25T20:00:00.000Z",
            randomId: () => "id",
            resolvedDependencies: {
              claudeExecutablePath: process.execPath,
              mcpBridgeConnection: {
                workspaceId: "workspace-1",
                hostUrl: "http://127.0.0.1:1",
                hostToken: "bridge-secret-value",
              },
              mcpCommand: [process.execPath],
            },
            runtimeId: "runtime-1",
            serviceInput,
            sessionInput: {
              externalSessionId: "session-1",
              claudePolicy: permissionMode ? { permissionMode } : null,
              options: {},
              startedMessage: "Started build session",
            },
            sessionStore,
          }),
        ).resolves.toMatchObject({
          externalSessionId: "session-1",
          status: "idle",
        });

        expect(events.map((event) => event.type)).toEqual(["session_started", "session_idle"]);
        const session = sessionStore.get("session-1");
        if (!session) {
          throw new Error("Expected initialized session");
        }
        sessionStore.close(session);
      } finally {
        streamFinished.resolve();
        querySpy.mockRestore();
      }
    },
  );

  test.each([
    { name: "fresh", options: {}, events: ["session_started", "session_idle"] },
    { name: "restored", options: { resume: "session-1" }, events: [] },
    {
      name: "forked",
      options: { resume: "source-session", forkSession: true },
      events: ["session_started", "session_idle"],
    },
  ])("publishes startup activity only for new sessions: $name", async (scenario) => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await expect(
        createClaudeAgentSdkSession({
          emit: (_session, event) => events.push(event),
          input: {
            repoPath: process.cwd(),
            runtimeKind: "claude",
            workingDirectory: process.cwd(),
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            systemPrompt: "Build",
          },
          initialTodos: [],
          now: () => "2026-06-25T20:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: "workspace-1",
              hostUrl: "http://127.0.0.1:1",
              hostToken: "bridge-secret-value",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput,
          sessionInput: {
            externalSessionId: "session-1",
            options: scenario.options,
            startedMessage: "Started build session",
          },
          sessionStore,
        }),
      ).resolves.toMatchObject({
        externalSessionId: "session-1",
        status: "idle",
      });

      expect(events.map((event) => event.type)).toEqual([...scenario.events]);
      const session = sessionStore.get("session-1");
      if (!session) {
        throw new Error("Expected initialized session");
      }
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("shares nested transcript state between SDK hooks and session events", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    let capturedOptions: realClaudeSdk.Options | undefined;
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(
      (input: Parameters<typeof realClaudeSdk.query>[0]) => {
        capturedOptions = input.options;
        return fakeQuery;
      },
    );

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await createClaudeAgentSdkSession({
        emit: () => {},
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:01.000Z",
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: {},
          startedMessage: "Started build session",
        },
        sessionStore,
      });

      const session = sessionStore.get("session-1");
      if (!session) {
        throw new Error("Expected initialized session");
      }
      session.subagentTaskIdsByToolUseId.set("agent-tool-1", "agent-1");
      const postToolUseHook = capturedOptions?.hooks?.PostToolUse?.[0]?.hooks[0];
      if (!postToolUseHook) {
        throw new Error("Expected PostToolUse hook");
      }
      await postToolUseHook(
        {
          hook_event_name: "PostToolUse",
          session_id: "session-1",
          transcript_path: "/home/test/.claude/projects/repo/session-1.jsonl",
          cwd: "/repo",
          agent_id: "agent-1",
          tool_name: "Read",
          tool_use_id: "inner-read-1",
          tool_input: { file_path: "/repo/README.md" },
          tool_response: { file: "/repo/README.md" },
          duration_ms: 250,
        },
        "inner-read-1",
        { signal: new AbortController().signal },
      );

      const childSession = claudeSubagentEventSession(session, "agent-tool-1");
      expect(childSession?.toolStartedAtMsByCallId.get("inner-read-1")).toBe(
        Date.parse("2026-06-25T20:00:00.750Z"),
      );
      expect(childSession?.toolEndedAtMsByCallId?.get("inner-read-1")).toBe(
        Date.parse("2026-06-25T20:00:01.000Z"),
      );
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("fails creation when the SDK stream ends before startup completes", async () => {
    const initialization =
      deferred<Awaited<ReturnType<realClaudeSdk.Query["initializationResult"]>>>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => {},
      initializationResult: () => initialization.promise,
      async *[Symbol.asyncIterator]() {},
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };
      const createPromise = createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: {},
          startedMessage: "Started build session",
        },
        sessionStore,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(sessionStore.get("session-1")).toBeUndefined();
      initialization.resolve({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      });

      await expect(createPromise).rejects.toMatchObject({
        operation: "claudeRuntime.createSession",
        message: "Claude session 'session-1' stopped before startup completed.",
      });
      expect(events.some((event) => event.type === "session_started")).toBe(false);
      expect(sessionStore.get("session-1")).toBeUndefined();
    } finally {
      querySpy.mockRestore();
    }
  });

  test("starts a titled fresh session without renaming a transcript that does not exist yet", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    const renameSession = mock(async () => {
      throw new Error("fresh sessions must not be renamed before their first message");
    });
    const query = mock((_input: Parameters<typeof realClaudeSdk.query>[0]) => fakeQuery);
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(query);
    const renameSessionSpy = spyOn(realClaudeSdk, "renameSession").mockImplementation(
      renameSession,
    );

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      const summary = await createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: { sessionId: "session-1" },
          startedMessage: "Started build session",
          title: "Builder",
        },
        sessionStore,
      });

      expect(summary).toMatchObject({
        externalSessionId: "session-1",
        status: "idle",
      });
      expect(query.mock.calls[0]?.[0].options?.title).toBe("Builder");
      expect(renameSession).not.toHaveBeenCalled();
      expect(events.map((event) => event.type)).toEqual(["session_started", "session_idle"]);
      const session = sessionStore.get("session-1");
      if (!session) {
        throw new Error("Expected initialized session");
      }
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
      renameSessionSpy.mockRestore();
    }
  });

  test("reports continuation admission before a resumed session rename fails", async () => {
    const streamFinished = deferred<void>();
    const teardownFinished = deferred<void>();
    const teardownStarted = deferred<void>();
    const renameStarted = deferred<void>();
    const queryReturn = mock(async () => {
      teardownStarted.resolve();
      await teardownFinished.promise;
      return { done: true, value: undefined } as const;
    });
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      async *[Symbol.asyncIterator]() {
        yield claudeSdkMessageFixture({
          type: "system",
          subtype: "session_state_changed",
          state: "running",
          uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
          session_id: "session-1",
        });
        await streamFinished.promise;
        yield* [];
      },
      return: queryReturn,
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);
    const renameSessionSpy = spyOn(realClaudeSdk, "renameSession").mockImplementation(async () => {
      renameStarted.resolve();
      throw new Error("rename unavailable");
    });

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const onContinuationAdmission = mock(() => {});
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      const creation = createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        onContinuationAdmission,
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: { resume: "session-1" },
          resumeInterruptedTurn: true,
          startedMessage: "Resumed build session",
          title: "Builder",
        },
        sessionStore,
      });
      let creationSettled = false;
      void creation.then(
        () => {
          creationSettled = true;
        },
        () => {
          creationSettled = true;
        },
      );

      await renameStarted.promise;
      await Promise.resolve();
      await Promise.resolve();

      expect(onContinuationAdmission).toHaveBeenCalledTimes(1);
      expect(queryReturn).toHaveBeenCalledTimes(1);
      await teardownStarted.promise;
      expect(creationSettled).toBe(false);

      teardownFinished.resolve();
      await expect(creation).rejects.toThrow("rename unavailable");

      expect(events.some((event) => event.type === "session_started")).toBe(false);
      expect(events.some((event) => event.type === "transcript_retracted")).toBe(false);
      expect(sessionStore.get("session-1")).toBeUndefined();
    } finally {
      streamFinished.resolve();
      teardownFinished.resolve();
      querySpy.mockRestore();
      renameSessionSpy.mockRestore();
    }
  });

  test("keeps a resumed repository session when the durable title cannot be reconciled", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      initializationResult: async () => ({
        account: {},
        agents: [],
        available_output_styles: [],
        commands: [],
        models: [],
        output_style: "default",
      }),
      mcpServerStatus: async () => [{ name: "openducktor", status: "connected" }],
      async *[Symbol.asyncIterator]() {
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);
    const renameSessionSpy = spyOn(realClaudeSdk, "renameSession").mockImplementation(async () => {
      throw new Error("rename unavailable");
    });

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      const summary = await createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "repository", title: "Fairnest" },
          systemPrompt: "",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-1",
          options: { resume: "session-1" },
          reconcileTitle: true,
          startedMessage: "Resumed session",
          title: "Fairnest",
        },
        sessionStore,
      });

      expect(renameSessionSpy).toHaveBeenCalledTimes(1);
      expect(renameSessionSpy.mock.calls[0]?.[0]).toBe("session-1");
      expect(renameSessionSpy.mock.calls[0]?.[1]).toBe("Fairnest");
      expect(summary.title).toBeUndefined();
      expect(summary.sessionAssociation).toEqual({ kind: "repository" });
      const session = sessionStore.get("session-1");
      if (session) sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
      renameSessionSpy.mockRestore();
    }
  });

  test("waits for continuation admission before clearing prior policy feedback", async () => {
    const streamFinished = deferred<void>();
    const admissionGate = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      async *[Symbol.asyncIterator]() {
        await admissionGate.promise;
        yield claudeSdkMessageFixture({
          type: "system",
          subtype: "init",
          permissionMode: "default",
          session_id: "session-continuation",
        });
        yield {
          ...claudeSdkMessageFixture({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: "Continue" }] },
            parent_tool_use_id: null,
            session_id: "session-continuation",
            uuid: "94db8937-6c10-4cfe-9aac-7bc9bc72f004",
          }),
          isSynthetic: true,
        };
        yield claudeSdkMessageFixture({
          type: "system",
          subtype: "session_state_changed",
          state: "running",
          uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
          session_id: "session-continuation",
        });
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const priorSession = createEventTestSession();
      priorSession.externalSessionId = "session-continuation";
      priorSession.requestedPermissionMode = "auto";
      handleClaudeSdkMessage({
        session: priorSession,
        message: claudeSdkMessageFixture({
          type: "system",
          subtype: "init",
          permissionMode: "default",
          session_id: "session-continuation",
        }),
        timestamp: "2026-06-25T19:59:00.000Z",
        modelSelection: (model) => ({
          providerId: "claude",
          modelId: model,
          runtimeKind: "claude",
        }),
        emit: (event) => events.push(event),
      });
      const priorNotice = events.find((event) => event.type === "session_policy_notice");
      expect(priorNotice).toBeDefined();
      const onContinuationAdmission = mock(() => {});
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      const creation = createClaudeAgentSdkSession({
        emit: (_session, event) => events.push(event),
        input: {
          repoPath: process.cwd(),
          runtimeKind: "claude",
          workingDirectory: process.cwd(),
          runtimePolicy: { kind: "claude" },
          sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
          systemPrompt: "Build",
        },
        initialTodos: [],
        now: () => "2026-06-25T20:00:00.000Z",
        onContinuationAdmission,
        randomId: () => "id",
        resolvedDependencies: {
          claudeExecutablePath: process.execPath,
          mcpBridgeConnection: {
            workspaceId: "workspace-1",
            hostUrl: "http://127.0.0.1:1",
            hostToken: "bridge-secret-value",
          },
          mcpCommand: [process.execPath],
        },
        runtimeId: "runtime-1",
        serviceInput,
        sessionInput: {
          externalSessionId: "session-continuation",
          options: {},
          resumeInterruptedTurn: true,
          startedMessage: "Continued build session",
        },
        sessionStore,
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(events.map((event) => event.type)).toEqual(["session_policy_notice"]);

      admissionGate.resolve();
      await expect(creation).resolves.toMatchObject({
        externalSessionId: "session-continuation",
        status: "running",
      });
      expect(events.map((event) => event.type)).toEqual([
        "session_policy_notice",
        "transcript_retracted",
        "session_started",
      ]);
      expect(events[1]).toMatchObject({
        externalSessionId: "session-continuation",
        messageIds: [priorNotice?.messageId],
      });
      expect(onContinuationAdmission).toHaveBeenCalledTimes(1);
      const session = sessionStore.get("session-continuation");
      if (!session) {
        throw new Error("Expected the admitted continuation session");
      }
      expect(session.activity).toBe("running");
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("admits a continuation from the hidden synthetic user turn", async () => {
    const streamFinished = deferred<void>();
    const fakeQuery = createClaudeQueryFixture({
      close: () => streamFinished.resolve(),
      async *[Symbol.asyncIterator]() {
        yield {
          ...claudeSdkMessageFixture({
            type: "user",
            message: { role: "user", content: [{ type: "text", text: "Continue" }] },
            parent_tool_use_id: null,
            session_id: "session-continuation",
            uuid: "7b7fe9e0-fd84-476f-8610-4c9ce2beb135",
          }),
          isSynthetic: true,
        };
        await streamFinished.promise;
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await expect(
        createClaudeAgentSdkSession({
          emit: (_session, event) => events.push(event),
          input: {
            repoPath: process.cwd(),
            runtimeKind: "claude",
            workingDirectory: process.cwd(),
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            systemPrompt: "Build",
          },
          initialTodos: [],
          now: () => "2026-06-25T20:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: "workspace-1",
              hostUrl: "http://127.0.0.1:1",
              hostToken: "bridge-secret-value",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput,
          sessionInput: {
            externalSessionId: "session-continuation",
            options: {},
            resumeInterruptedTurn: true,
            startedMessage: "Continued build session",
          },
          sessionStore,
        }),
      ).resolves.toMatchObject({
        externalSessionId: "session-continuation",
        status: "running",
      });
      expect(events.map((event) => event.type)).toEqual([
        "transcript_retracted",
        "session_started",
      ]);
      const session = sessionStore.get("session-continuation");
      if (!session) {
        throw new Error("Expected the admitted continuation session");
      }
      sessionStore.close(session);
    } finally {
      streamFinished.resolve();
      querySpy.mockRestore();
    }
  });

  test("refuses a continuation that the runtime never admits", async () => {
    const { awaitClaudeContinuationAdmission } = await import("./claude-agent-sdk-session-factory");

    await expect(
      awaitClaudeContinuationAdmission({
        admission: new Promise<void>(() => {}),
        externalSessionId: "session-continuation",
        runtimeId: "runtime-1",
        timeoutMs: 5,
      }),
    ).rejects.toMatchObject({
      operation: "claudeRuntime.createSession",
      message:
        "Claude session 'session-continuation' did not start the interrupted-turn continuation within 5 ms.",
      cause: expect.objectContaining({
        reason: "continuation_failed",
        message:
          "Claude Code did not start the continuation for session 'session-continuation'. Send a new message to continue.",
      }),
    });
  });

  test("reports a continuation failure when the stream ends before admission", async () => {
    const fakeQuery = createClaudeQueryFixture({
      close: () => {},
      return: async () => ({ done: true, value: undefined }),
      async *[Symbol.asyncIterator]() {
        yield* [];
      },
    });
    const querySpy = spyOn(realClaudeSdk, "query").mockImplementation(() => fakeQuery);

    try {
      const { createClaudeAgentSdkSession } = await import("./claude-agent-sdk-session-factory");
      const events: AgentEvent[] = [];
      const sessionStore = createClaudeAgentSdkSessionStore();
      const serviceInput: CreateClaudeAgentSdkServiceInput = {
        claudeExecutablePath: process.execPath,
        launchPolicy: {
          resolve: () => Effect.succeed({}),
        },
        onBackgroundFailure: () => Effect.void,
        resolveMcpBridgeConnection: () => Effect.die("unused"),
        runtimeDistribution: createArtifactRuntimeDistribution({
          mcpLauncher: { kind: "executable", executablePath: process.execPath },
        }),
        sessionStore,
        toolDiscovery: createToolDiscovery(),
      };

      await expect(
        createClaudeAgentSdkSession({
          emit: (_session, event) => events.push(event),
          input: {
            repoPath: process.cwd(),
            runtimeKind: "claude",
            workingDirectory: process.cwd(),
            runtimePolicy: { kind: "claude" },
            sessionScope: { kind: "workflow", taskId: "task-1", role: "build" },
            systemPrompt: "Build",
          },
          initialTodos: [],
          now: () => "2026-06-25T20:00:00.000Z",
          randomId: () => "id",
          resolvedDependencies: {
            claudeExecutablePath: process.execPath,
            mcpBridgeConnection: {
              workspaceId: "workspace-1",
              hostUrl: "http://127.0.0.1:1",
              hostToken: "bridge-secret-value",
            },
            mcpCommand: [process.execPath],
          },
          runtimeId: "runtime-1",
          serviceInput,
          sessionInput: {
            externalSessionId: "session-continuation",
            options: {},
            resumeInterruptedTurn: true,
            startedMessage: "Continued build session",
          },
          sessionStore,
        }),
      ).rejects.toMatchObject({
        operation: "claudeRuntime.createSession",
        message:
          "Claude session 'session-continuation' ended before it admitted the interrupted-turn continuation.",
        cause: expect.objectContaining({ reason: "continuation_failed" }),
      });

      expect(sessionStore.get("session-continuation")).toBeUndefined();
      expect(events.some((event) => event.type === "session_started")).toBe(false);
      expect(events.some((event) => event.type === "transcript_retracted")).toBe(false);
      expect(
        events.some((event) => event.type === "session_finished" || event.type === "session_error"),
      ).toBe(false);
    } finally {
      querySpy.mockRestore();
    }
  });
});
