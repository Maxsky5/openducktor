import { builtinWorkflowRolePolicy } from "../../test-support/workflow-role-policy";
import { builtinTaskWorkflows } from "../../test-support/task-workflows";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  workspaceSessionCatalog,
  workspaceSessionOwnership,
} from "../../test-support/workspace-session-ownership";
import { createPrepareOpencodeSessionRuntime } from "@openducktor/adapters-opencode-sdk";
import {
  globalConfigSchema,
  repoConfigSchema,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { Effect, Result, Stream } from "effect";
import { createSqliteTaskStoreHarness } from "../../adapters/sqlite/sqlite-task-store-test-support";
import { createSqliteWorkspaceSessionStore } from "../../adapters/sqlite/sqlite-workspace-session-store";
import {
  createTestOpenCodeLiveSessionAdapterPreparer,
  runtime,
} from "../../adapters/agent-sessions/opencode-live-session-adapter.test-support";
import { createLiveSessionAdapterRegistry } from "../../adapters/agent-sessions/live-session-adapter-registry";
import { createAgentSessionLiveStateService } from "../../application/agent-sessions/agent-session-live-state-service";
import { createNotificationService } from "../../application/notifications/notification-service";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { noMessageQueues } from "../../test-support/message-queue-observer-test-double";
import { createFixedRuntimeSettingsConfig } from "../../test-support/runtime-settings-config";
import { createLiveSessionRootRefsReader } from "./live-session-root-refs";
import { enrichTasks } from "../../application/tasks/support/task-workflow-helpers";

test.each([
  { status: "closed", failure: "missing directory" },
  { status: "in_progress", failure: "missing directory" },
  { status: "in_progress", failure: "native access" },
] as const)(
  "$status task with $failure keeps notification health clear across renderer attachments",
  async ({ status, failure }) => {
    const repoPath = await mkdtemp(path.join(tmpdir(), "odt-session-restoration-"));
    const db = await createSqliteTaskStoreHarness({ repoPath });
    const workspaceId = "fairnest";
    const config = repoConfigSchema.parse({ workspaceId, workspaceName: "Fairnest", repoPath });
    const store = createSqliteWorkspaceSessionStore(db);
    const task = await Effect.runPromise(
      db.store.createTask({
        ...db.scope,
        status: "open",
        task: { title: "Saved build", issueType: "bug", priority: 2 },
      }),
    );
    const saved = createAgentSessionRecord({
      externalSessionId: "ses_task",
      workingDirectory: failure === "missing directory" ? `${repoPath}/removed-worktree` : repoPath,
    });
    await Effect.runPromise(
      db.store.upsertAgentSession({
        workspaceId,
        ownershipScope: workspaceSessionOwnership({ workspaceId, repoPath }),
        repoPath,
        taskId: task.id,
        session: saved,
      }),
    );
    await Effect.runPromise(
      db.store.transitionTask({
        ...db.scope,
        taskId: task.id,
        decide: () => Result.succeed({ status, workflowId: "openducktor" }),
      }),
    );
    const chat: WorkspaceSession = {
      id: "workspace-chat",
      runtimeKind: "opencode",
      externalSessionId: "ses_workspace",
      executionTarget: { kind: "local_repo_root", workingDirectory: repoPath },
      roleSnapshot: null,
      selectedModel: null,
      generatedTitle: null,
      manualTitle: null,
      targetBranch: null,
      createdAt: 1,
      updatedAt: 1,
      archivedAt: null,
    };
    await Effect.runPromise(
      store.create({
        repoPath,
        workspaceId,
        ownershipScope: workspaceSessionOwnership({ workspaceId, repoPath }),
        session: chat,
      }),
    );
    const history = await Effect.runPromise(
      db.store.getTaskMetadata({ ...db.scope, taskId: task.id }),
    );
    const directoryReads: string[] = [];
    const nativeReads: string[] = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const path = new URL(request.url).pathname;
        if (path === "/api/info")
          return Response.json({ version: "2.0.24", pid: 42, urls: [], paths: { tmp: "/tmp" } });
        if (path === "/api/event")
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"id":"connected","type":"server.connected","data":{}}\n\n',
                  ),
                );
              },
            }),
            { headers: { "Content-Type": "text/event-stream" } },
          );
        if (path.endsWith("/migration/v1")) return Response.json({ status: "completed" });
        if (path === "/api/location")
          return Response.json({
            directory: repoPath,
            project: { id: "project", directory: repoPath, canonical: repoPath },
          });
        if (path === "/api/session/active") return Response.json({ data: {} });
        if (/\/(permission|form|inbox|instructions\/entries)$/.test(path))
          return Response.json({ data: [] });
        if (path === "/api/session" || path.endsWith("/message"))
          return Response.json({ data: [], cursor: { next: null, prev: null } });
        if (path === "/api/session/ses_task" || path === "/api/session/ses_workspace") {
          const id = path.split("/").at(-1)!;
          nativeReads.push(id);
          if (id === "ses_task")
            return new Response("Native conversation is inaccessible. Check OpenCode access.", {
              status: 403,
            });
          return Response.json({
            data: {
              id,
              title: "Workspace conversation",
              projectID: "project",
              location: { directory: repoPath },
              time: { created: 1, updated: 2 },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            },
          });
        }
        throw new Error(`Unexpected native request ${request.method} ${path}`);
      },
    });
    const settingsConfig = {
      ...createFixedRuntimeSettingsConfig("opencode", "opencode"),
      readConfig: () =>
        Effect.succeed(
          globalConfigSchema.parse({ version: 4, workspaces: { [workspaceId]: config } }),
        ),
    };
    const live = createAgentSessionLiveStateService({
      messageQueues: noMessageQueues,
      adapterRegistry: createLiveSessionAdapterRegistry(),
      runtimeAdmission: { admit: (_kind, effect) => effect },
      readSessionRootRefs: createLiveSessionRootRefsReader({
        store,
        settings: { getWorkspaceCatalog: () => Effect.succeed(workspaceSessionCatalog(config)) },
      }),
      faultLog: () => Effect.void,
      publish: () => {},
      observeNotificationInput: (envelope, provenance) =>
        notifications.acceptLive(envelope, provenance),
    });
    const notifications = createNotificationService({
      taskWorkflows: builtinTaskWorkflows,
      settingsConfig,
      tasks: {
        listTasks: (input) =>
          db.store
            .listTasks(input)
            .pipe(Effect.map((tasks) => enrichTasks(builtinTaskWorkflows, tasks))),
        agentSessionsListForTasks: db.store.listAgentSessionsForTasks,
      },
      live,
      workspaceSessions: store,
      boundIdentity: (identity) => identity,
    });
    try {
      const prepared = await Effect.runPromise(
        createTestOpenCodeLiveSessionAdapterPreparer({
          resolveWorkflowRolePolicy: builtinWorkflowRolePolicy,
          liveSessionLifecycle: live,
          prepareRuntime: createPrepareOpencodeSessionRuntime({
            resolveWorkflowRolePolicy: builtinWorkflowRolePolicy,
            resolveCreationSettings: async () => ({ defaults: [], role: [] }),
            resolveMcpServerConfig: async () => {
              throw new Error("Restoration must not install MCP");
            },
            readDirectory: async (directory, read) => {
              directoryReads.push(directory);
              return existsSync(directory) ? read() : null;
            },
          }),
        })({ ...runtime, runtimeRoute: { type: "local_http", endpoint: server.url.origin } }),
      );
      await Effect.runPromise(live.registerRuntimeAdapter(prepared.adapter));
      await Effect.runPromise(prepared.startForwarding());
      const initialization = Effect.runPromise(
        notifications.stream.subscribe({ cursor: null }).pipe(
          Stream.takeUntil(
            (frame) =>
              frame.type === "health" &&
              frame.health.source === "initialization" &&
              frame.health.message === null,
          ),
          Stream.runCollect,
          Effect.timeout("2 seconds"),
        ),
      );
      await Effect.runPromise(notifications.initialize());
      const frames = await initialization;
      const faults = frames.filter(
        (frame) => frame.type === "health" && frame.health.message !== null,
      );
      // A failed session restore is a session fault. The session views show it, and
      // notification observation keeps working.
      expect(faults).toEqual([]);
      if (status === "closed") expect(directoryReads).toEqual([repoPath]);
      for (let attachment = 0; attachment < 2; attachment++) {
        const reconnect = await Effect.runPromise(
          notifications.stream.subscribe({ cursor: null }).pipe(Stream.take(1), Stream.runCollect),
        );
        expect(reconnect[0]).toMatchObject({ type: "attached" });
        const attached = reconnect[0];
        if (attached?.type !== "attached") throw new Error("Expected notification attachment");
        expect(attached.health).toEqual([]);
      }
      expect(nativeReads).toEqual(
        failure === "native access" ? ["ses_workspace", "ses_task"] : ["ses_workspace"],
      );
      expect(await Effect.runPromise(live.list({ repoPath }))).toMatchObject([
        {
          ref: {
            repoPath,
            workingDirectory: repoPath,
            externalSessionId: "ses_workspace",
            runtimeKind: "opencode",
          },
          repositoryScope: { kind: "repository" },
        },
      ]);
      expect(
        await Effect.runPromise(db.store.getTaskMetadata({ ...db.scope, taskId: task.id })),
      ).toEqual(history);
    } finally {
      await Effect.runPromise(notifications.dispose());
      await Effect.runPromise(live.releaseRuntime(runtime.runtimeId));
      server.stop(true);
      await db.cleanup();
      await rm(repoPath, { recursive: true, force: true });
    }
  },
);
