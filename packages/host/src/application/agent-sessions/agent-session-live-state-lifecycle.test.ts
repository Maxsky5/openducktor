import { describe, expect, test } from "bun:test";
import {
  repoConfigSchema,
  type AgentSessionLiveEnvelope,
  type AgentSessionScope,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createOpenCodeLiveSessionAdapterPreparer } from "../../adapters/agent-sessions/opencode-live-session-adapter";
import {
  createRuntimeHarness,
  runtime,
  ref,
  ignoreObservationLoss,
} from "../../adapters/agent-sessions/opencode-live-session-adapter.test-support";
import { createTestRuntimeAdmissionGate } from "../../test-support/runtime-admission-test-gate";
import { createAgentSessionLiveStateService } from "./agent-session-live-state-service";
import { createSessionSpeedWriter } from "./agent-session-speed-persistence";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";

describe("live runtime registration lifecycle", () => {
  test.each([
    { owner: "workspace", release: "runtime" },
    { owner: "task", release: "runtime" },
    { owner: "workspace", release: "session" },
    { owner: "task", release: "session" },
  ] as const)(
    "a released $release report cannot overwrite the replacement's saved $owner choice",
    async ({ owner, release }) => {
      const database = await createSqliteTaskStoreHarness();
      const readEntered = Promise.withResolvers<void>();
      const finishRead = Promise.withResolvers<void>();
      try {
        const { repoPath } = database;
        const config = repoConfigSchema.parse({
          workspaceId: "fairnest",
          workspaceName: "Fairnest",
          repoPath,
        });
        const store = createSqliteWorkspaceSessionStore(database.contextProvider);
        const identity = { ...ref, repoPath, workingDirectory: repoPath };
        const task = await Effect.runPromise(
          database.store.createTask({
            repoPath,
            task: { title: "Speed", issueType: "task", priority: 2, aiReviewEnabled: true },
          }),
        );
        if (owner === "workspace") {
          const session: WorkspaceSession = {
            id: "chat",
            runtimeKind: identity.runtimeKind,
            externalSessionId: identity.externalSessionId,
            executionTarget: { kind: "local_repo_root", workingDirectory: repoPath },
            roleSnapshot: null,
            selectedModel: null,
            generatedTitle: null,
            manualTitle: null,
            createdAt: 1,
            updatedAt: 1,
            speed: "fast",
            archivedAt: null,
          };
          await Effect.runPromise(
            store.create({ repoPath, workspaceId: config.workspaceId, session }),
          );
        } else {
          await Effect.runPromise(
            database.store.upsertAgentSession({
              repoPath,
              taskId: task.id,
              session: createAgentSessionRecord({ ...identity, speed: "fast" }),
            }),
          );
        }
        let reads = 0;
        const published: boolean[] = [];
        const writer = createSessionSpeedWriter({
          store,
          taskStore: database.store,
          settings: {
            getRepoConfigByRepoPath: () =>
              Effect.promise(async () => {
                if (++reads === 1) {
                  readEntered.resolve();
                  await finishRead.promise;
                }
                return config;
              }),
          },
          publishWorkspace: (_workspaceId, session) =>
            Effect.sync(() => {
              published.push(session.speed === "fast");
            }),
          publishTask: () => Effect.void,
        });
        const service = createAgentSessionLiveStateService({
          runtimeAdmission: createTestRuntimeAdmissionGate(),
          adapterRegistry: createLiveSessionAdapterRegistry(),
          faultLog: () => Effect.void,
          publish: () => {},
          persistence: { observe: () => Effect.void, recordSpeedChoice: writer },
        });
        const prepare = () =>
          Effect.runPromise(
            createOpenCodeLiveSessionAdapterPreparer({
              liveSessionLifecycle: service,
              prepareRuntime: createRuntimeHarness().prepareRuntime,
            })(runtime, ignoreObservationLoss),
          );
        const old = await prepare();
        await Effect.runPromise(service.registerRuntimeAdapter(old.adapter));
        let current = true;
        const oldSave = Effect.runPromiseExit(
          old.adapter.binding.recordSpeedChoice(identity, "standard", () => current),
        );
        await readEntered.promise;
        if (release === "runtime")
          await Effect.runPromise(service.releaseRuntime(runtime.runtimeId));
        else current = false;
        expect(await Effect.runPromise(service.list({ repoPath: "/other-repository" }))).toEqual(
          [],
        );
        const replacement = release === "runtime" ? await prepare() : old;
        if (release === "runtime")
          await Effect.runPromise(service.registerRuntimeAdapter(replacement.adapter));
        const publish = await Effect.runPromise(
          replacement.adapter.binding.recordSpeedChoice(identity, "fast", () => true),
        );
        await Effect.runPromise(publish);
        finishRead.resolve();
        const exit = await oldSave;
        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("was released");
        const saved =
          owner === "workspace"
            ? (
                await Effect.runPromise(
                  store.get({ repoPath, workspaceId: config.workspaceId, sessionId: "chat" }),
                )
              ).speed
            : (
                await Effect.runPromise(
                  database.store.listAgentSessionsForTasks({ repoPath, taskIds: [task.id] }),
                )
              )[0]?.agentSessions[0]?.speed;
        expect(saved).toBe("fast");
        expect(published).toEqual(owner === "workspace" ? [true] : []);
        current = true;
        const latePublish = await Effect.runPromise(
          replacement.adapter.binding.recordSpeedChoice(identity, "standard", () => current),
        );
        current = false;
        const publishExit = await Effect.runPromiseExit(latePublish);
        expect(Exit.isFailure(publishExit)).toBe(true);
        expect(published).toEqual(owner === "workspace" ? [true] : []);
      } finally {
        finishRead.resolve();
        await database.cleanup();
      }
    },
    2000,
  );

  test.each([
    { kind: "workflow", taskId: "task-1", role: "build" },
    { kind: "repository" },
  ] satisfies AgentSessionScope[])(
    "releases a runtime during a $kind control without blocking other repositories",
    async (sessionScope) => {
      const nativeEntered = Promise.withResolvers<void>();
      const nativeFinish = Promise.withResolvers<void>();
      const detached = Promise.withResolvers<void>();
      const registry = createLiveSessionAdapterRegistry();
      const events: AgentSessionLiveEnvelope[] = [];
      const runtimeAdmission = createTestRuntimeAdmissionGate();
      runtimeAdmission.open(runtime.kind);
      const service = createAgentSessionLiveStateService({
        runtimeAdmission,
        adapterRegistry: {
          ...registry,
          remove: (id) =>
            registry.remove(id).pipe(Effect.tap(() => Effect.sync(() => detached.resolve()))),
        },
        faultLog: () => Effect.void,
        publish: (event) => {
          events.push(event);
        },
      });
      const native = createRuntimeHarness();
      const prepared = await Effect.runPromise(
        createOpenCodeLiveSessionAdapterPreparer({
          liveSessionLifecycle: service,
          prepareRuntime: async (input) => {
            const preparedNative = await native.prepareRuntime(input);
            return {
              ...preparedNative,
              connection: {
                ...preparedNative.connection,
                resumeSession: async (request) => {
                  nativeEntered.resolve();
                  await nativeFinish.promise;
                  return preparedNative.connection.resumeSession(request);
                },
              },
            };
          },
        })(runtime, ignoreObservationLoss),
      );
      await Effect.runPromise(service.registerRuntimeAdapter(prepared.adapter));
      const resumed = Effect.runPromiseExit(
        service.resumeSession({ resumeMode: "reattach", ...ref, sessionScope }),
      );
      await nativeEntered.promise;
      const released = Effect.runPromiseExit(service.releaseRuntime(runtime.runtimeId));
      await detached.promise;
      try {
        expect(await Effect.runPromise(service.list({ repoPath: "/other-repository" }))).toEqual(
          [],
        );
      } finally {
        nativeFinish.resolve();
      }
      const [resumeExit, releaseExit] = await Promise.all([resumed, released]);
      expect(Exit.isFailure(resumeExit)).toBe(true);
      if (Exit.isFailure(resumeExit))
        expect(Cause.pretty(resumeExit.cause)).toContain("was released");
      expect(Exit.isSuccess(releaseExit)).toBe(true);
      expect(await Effect.runPromise(service.list({ repoPath: ref.repoPath }))).toEqual([]);
      expect(native.releaseCalls).toHaveLength(1);
      const eventCount = events.length;
      await Effect.runPromise(
        prepared.adapter.binding.runMutation(
          Effect.succeed({
            value: undefined,
            changes: [{ type: "fault", repoPath: ref.repoPath, message: "late native event" }],
          }),
        ),
      );
      expect(events).toHaveLength(eventCount);
      const copiedLease = { ...prepared.adapter.binding };
      await Effect.runPromise(
        copiedLease.runMutation(
          Effect.succeed({
            value: undefined,
            changes: [{ type: "fault", repoPath: ref.repoPath, message: "copied late callback" }],
          }),
        ),
      );
      expect(events).toHaveLength(eventCount);
      const preparedLease = service.createRuntimeRegistration(prepared.adapter.binding);
      await Effect.runPromise(
        preparedLease.runMutation(
          Effect.succeed({
            value: undefined,
            changes: [{ type: "fault", repoPath: ref.repoPath, message: "not registered" }],
          }),
        ),
      );
      expect(events).toHaveLength(eventCount);
    },
    1000,
  );
});
