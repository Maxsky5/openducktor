import type { TerminalContext } from "@openducktor/contracts";
import type { DemoSessionAdapter } from "@/host-session/host-session-owner";
import type { SessionResource } from "@/host-session/session-resources";
import { createDemoClock, type DemoTimers } from "./demo-clock";
import { createDemoHostClient, type DemoHandlers } from "./demo-host-client";
import { createDemoHostConnection } from "./demo-host-connection";
import { createDemoLaunches } from "./demo-launches";
import { createDemoSessionEngine } from "./demo-sessions";
import { createDemoTaskStore, fromBase64 } from "./demo-tasks";
import { createDemoTerminals } from "./demo-terminals";
import { createDemoWorkspaceHandlers } from "./demo-workspace-handlers";
import { type DemoWorld, findWorkspace } from "./demo-world";
import { seedDemo } from "./fixtures/seed";

/** The workspace that the demo opens on. */
const DEMO_INITIAL_WORKSPACE_ID = "fieldnotes";

const resourceOf = (entry: { mime: string; base64: string }): SessionResource => ({
  bytes: fromBase64(entry.base64),
  headers: { "content-type": entry.mime },
});

/**
 * Creates the local backend of one demo session: fresh sample data in memory, a host client that
 * answers on the device, its event streams, its terminals, and its resource reads. Nothing in it
 * reaches a network, a shell, or a model. An abort of `lifetime` stops every scripted event.
 */
export const createDemoSessionAdapter = (
  lifetime: AbortSignal,
  timers?: DemoTimers,
): DemoSessionAdapter => {
  const clock = createDemoClock(lifetime, timers);
  const handlers: DemoHandlers = {};
  let disposed = false;
  const client = createDemoHostClient(handlers, lifetime, () => disposed);
  const { connection, events } = createDemoHostConnection(client, clock);
  let nextNumber = 1;
  const world: DemoWorld = {
    clock,
    events,
    workspaces: new Map(),
    resources: new Map(),
    customRoles: [
      {
        id: "reviewer",
        name: "Reviewer",
        systemPrompt: "Review the change for clarity and missing tests. Do not edit files.",
      },
    ],
    sessions: {
      stopTaskSessions: () => {},
      forgetTaskSessions: () => {},
      taskSessionRecords: () => [],
      runningTaskSessionCount: () => 0,
    },
    nextPullRequestNumber: 128,
    nextNumber: () => nextNumber++,
  };

  const contextWorkspace = (context: TerminalContext) =>
    "workspaceId" in context ? findWorkspace(world, context.workspaceId) : null;
  const checkoutAt = (workingDir: string) => {
    for (const workspace of world.workspaces.values()) {
      const checkout = workspace.repository.findCheckout(workingDir);
      if (checkout) return { workspace, checkout };
    }
    return null;
  };
  const terminals = createDemoTerminals(
    {
      findAction: (context, actionId) => {
        const workspace =
          contextWorkspace(context) ?? world.workspaces.get(DEMO_INITIAL_WORKSPACE_ID) ?? null;
        return workspace?.actionOutput.get(actionId) ?? null;
      },
      gitStatus: (workingDir) => {
        const found = checkoutAt(workingDir);
        return found
          ? found.workspace.repository.statusLines(found.checkout)
          : ["fatal: not a git repository"];
      },
      listFiles: (workingDir) => {
        const found = checkoutAt(workingDir);
        if (!found) return [];
        const top = new Set(
          found.workspace.repository
            .paths(found.checkout)
            .map((path) => path.split("/")[0] ?? path),
        );
        return [...top].sort();
      },
    },
    clock,
  );

  const tasks = createDemoTaskStore(world);
  const engine = createDemoSessionEngine(world);
  world.sessions = {
    stopTaskSessions: (workspace, taskId) => {
      for (const session of engine.taskSessions(workspace, taskId)) engine.stopRun(session);
    },
    forgetTaskSessions: (workspace, taskId, roles) => {
      const forgotten = roles ? new Set(roles) : null;
      for (const session of engine.taskSessions(workspace, taskId)) {
        if (forgotten && session.owner.kind === "task" && !forgotten.has(session.owner.role))
          continue;
        engine.forget(session);
      }
      engine.publishTaskRecords(workspace, taskId);
    },
    taskSessionRecords: (workspace, taskId) =>
      engine.taskSessions(workspace, taskId).map(engine.taskRecordOf),
    runningTaskSessionCount: (workspace, taskId) =>
      engine.taskSessions(workspace, taskId).filter((session) => session.run !== null).length,
  };
  const launches = createDemoLaunches({ world, engine, tasks, terminals });
  Object.assign(
    handlers,
    createDemoWorkspaceHandlers(world),
    tasks.handlers,
    engine.handlers,
    launches.handlers,
    terminals.handlers,
  );
  seedDemo({ world, engine, outcomes: tasks, terminals });

  const resource = (key: string, signal: AbortSignal): SessionResource => {
    signal.throwIfAborted();
    const entry = world.resources.get(key);
    if (!entry) throw new Error("This file is not in the demo. Attach it again.");
    return resourceOf(entry);
  };

  return {
    host: connection,
    terminalBridge: terminals.bridge,
    resources: {
      readTaskAsset: async (context, signal) => resource(`asset:${context.assetId}`, signal),
      readStagedPreview: async (path, signal) => resource(path, signal),
    },
    initialWorkspaceId: DEMO_INITIAL_WORKSPACE_ID,
    dispose: async () => {
      disposed = true;
      world.workspaces.clear();
      world.resources.clear();
      engine.sessions.clear();
    },
  };
};
