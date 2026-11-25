import { describe, expect, test } from "bun:test";
import { QueryObserver, type QueryKey } from "@tanstack/react-query";
import type { WorkflowLibraryChangeListener } from "../connection/host-connection";
import { connectionReconnectedEvent } from "../recovery/connection-control-events";
import {
  builtinWorkflowCatalogFixture,
  builtinWorkspaceWorkflowFixture,
} from "../test-support/workflow-fixtures";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../test-support/test-client-connection";
import { autopilotQueryKeys } from "./autopilot";
import { taskQueryKeys } from "./tasks";
import { observeWorkflowLibraryChanges } from "./workflow-library-changes";
import { workflowLibraryQueryKeys } from "./workflow-library";
import {
  workflowCatalogQueryOptions,
  workflowQueryKeys,
  workspaceWorkflowQueryOptions,
} from "./workflows";
import { workspaceQueryKeys } from "./workspace";

const scope = { workspaceId: "repo", repoPath: "/repo" };
const libraryKey = workflowLibraryQueryKeys.versions("alpha");

const setup = async () => {
  const reads = { catalog: 0, context: 0 };
  let emit: WorkflowLibraryChangeListener = () => {
    throw new Error("The observer did not subscribe.");
  };
  const connection = createTestClientConnection({
    host: createTestHostConnection({
      client: {
        workflowCatalogGet: async () => {
          reads.catalog += 1;
          return structuredClone(builtinWorkflowCatalogFixture);
        },
        workspaceWorkflowGet: async () => {
          reads.context += 1;
          return structuredClone(builtinWorkspaceWorkflowFixture);
        },
      },
      subscribeWorkflowLibraryChanges: async (listener) => {
        emit = listener;
        return () => {};
      },
    }),
  });
  const { queryClient } = connection;
  await queryClient.fetchQuery(workflowCatalogQueryOptions());
  await queryClient.fetchQuery(workspaceWorkflowQueryOptions(scope));
  for (const key of [
    libraryKey,
    workspaceQueryKeys.settingsSnapshot(),
    workspaceQueryKeys.repoConfig(scope.workspaceId),
    autopilotQueryKeys.settings(),
    taskQueryKeys.repoData(scope),
  ])
    queryClient.setQueryData(key, {});
  const stop = observeWorkflowLibraryChanges(queryClient);
  // The subscription resolves in a microtask.
  await Promise.resolve();
  const stale = (key: QueryKey) => queryClient.getQueryState(key)?.isInvalidated;
  return {
    connection,
    queryClient,
    reads,
    emit: (event: Parameters<typeof emit>[0]) => emit(event),
    stale,
    stop,
  };
};

describe("workflow library changes", () => {
  test("a library event marks the workflow, library, and settings reads stale and reads the observed ones", async () => {
    const h = await setup();
    const observer = new QueryObserver(h.queryClient, workspaceWorkflowQueryOptions(scope));
    const unsubscribe = observer.subscribe(() => {});
    try {
      expect(h.reads).toEqual({ catalog: 1, context: 1 });
      await h.emit({});
      // The board observes its workspace read, which reads the stale catalog too.
      expect(h.reads).toEqual({ catalog: 2, context: 2 });
      expect(h.stale(workflowQueryKeys.catalog)).toBe(false);
      expect(h.stale(workflowQueryKeys.workspace(scope))).toBe(false);
      expect(h.stale(libraryKey)).toBe(true);
      expect(h.stale(workspaceQueryKeys.settingsSnapshot())).toBe(true);
      expect(h.stale(workspaceQueryKeys.repoConfig(scope.workspaceId))).toBe(true);
      expect(h.stale(autopilotQueryKeys.settings())).toBe(true);
      // Task cards resolve again against the new catalog, so role changes reach them.
      expect(h.stale(taskQueryKeys.repoData(scope))).toBe(true);
    } finally {
      unsubscribe();
      h.stop();
      await h.connection.dispose();
    }
  });

  test("a reconnect with missed events reads the library and settings again and leaves the catalog to recovery", async () => {
    const h = await setup();
    try {
      await h.emit(connectionReconnectedEvent(false, { hostChanged: false, missedEventNames: [] }));
      expect(h.stale(libraryKey)).toBe(false);
      await h.emit(connectionReconnectedEvent(true, { hostChanged: false, missedEventNames: [] }));
      expect(h.stale(libraryKey)).toBe(true);
      expect(h.stale(workspaceQueryKeys.settingsSnapshot())).toBe(true);
      expect(h.stale(workflowQueryKeys.catalog)).toBe(false);
      expect(h.stale(workflowQueryKeys.workspace(scope))).toBe(false);
      expect(h.reads).toEqual({ catalog: 1, context: 1 });
    } finally {
      h.stop();
      await h.connection.dispose();
    }
  });
});
