import { workspaceScopeKey } from "../queries/workspace-scope";
import type { WorkspaceRecord, WorkspaceRef } from "@openducktor/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useHostConnection } from "../connection/client-connection-react";
import { useOpenWorkspaceTaskLists } from "../queries/use-open-workspace-task-lists";
import { useAgentSessionsContext } from "../sessions/session-contexts";
import {
  createHostTaskStreamController,
  type HostTaskStreamInput,
} from "./host-task-stream-controller";
import { summarizeTaskLoadError } from "./task-load-errors";
import type { TaskStreamController } from "./task-stream-controller";

export type TaskStreamControllerFactory = (
  input: Required<HostTaskStreamInput>,
) => TaskStreamController;

/** The task stream controllers of the host connection of this tree. */
export const useHostTaskStreamControllerFactory = (): TaskStreamControllerFactory => {
  const host = useHostConnection();
  const { listSessionTaskIds, removeTaskSessions } = useAgentSessionsContext();
  return useMemo<TaskStreamControllerFactory>(
    () => (input) =>
      createHostTaskStreamController(host, { listSessionTaskIds, removeTaskSessions }, input),
    [host, listSessionTaskIds, removeTaskSessions],
  );
};

/** How the start of one controller ended. A controller that stops before its start ends is stopped. */
export type TaskStreamStart = "started" | "unavailable" | "stopped";

type HostTaskStreamEvents = {
  /** The stream fell behind. The description tells why. */
  onDegraded: (description: string) => void;
  /** A snapshot could not reconcile some open workspaces. The description has one line for each. */
  onWorkspaceFailures: (description: string) => void;
  /** The stream could not start. */
  onUnavailable: (cause: unknown) => void;
  onSnapshotStarted?: (repoPath: WorkspaceRef) => void;
  onSnapshotFinished?: (repoPath: WorkspaceRef, succeeded: boolean) => void;
  /** Runs before the stream releases the task data of a workspace that closed. */
  onWorkspaceReleased?: (repoPath: WorkspaceRef) => void;
  /**
   * Runs before each controller starts. The function that it returns receives how the start of
   * that controller ended.
   */
  trackStart?: () => (start: TaskStreamStart) => void;
};

const describeWorkspaceFailures = (failures: ReadonlyMap<WorkspaceRef, unknown>): string =>
  [...failures]
    .map(
      ([repoPath, error]) =>
        `${repoPath.workspaceId} (${repoPath.repoPath}): ${summarizeTaskLoadError({ error })}`,
    )
    .join("\n");

/**
 * Runs the task stream of the host connection. Task changes from this client, other clients, and
 * agents then reach the cached task lists, documents, and session lists of the open workspaces.
 * The task lists of all open workspaces stay cached, so a workspace switch shows its list at once.
 * A workspace that closes drops its cached task data. The events read their latest callbacks, so
 * a new callback does not restart the stream. Returns the identities of the open workspaces.
 */
export function useHostTaskStream({
  openWorkspaces,
  activeRepoPath,
  activeWorkspaceId,
  createController,
  events,
}: {
  openWorkspaces: readonly Pick<WorkspaceRecord, "workspaceId" | "repoPath">[];
  activeRepoPath: string | null;
  activeWorkspaceId: string | null;
  createController: TaskStreamControllerFactory;
  events: HostTaskStreamEvents;
}): readonly WorkspaceRef[] {
  const queryClient = useQueryClient();
  const openRepoPaths = useOpenWorkspaceTaskLists({
    openWorkspaces,
    activeRepoPath,
    activeWorkspaceId,
  });
  const openRepoPathsRef = useRef(openRepoPaths);
  const activeRepoPathRef = useRef<WorkspaceRef | null>(
    activeRepoPath && activeWorkspaceId
      ? { workspaceId: activeWorkspaceId, repoPath: activeRepoPath }
      : null,
  );
  const eventsRef = useRef(events);
  useLayoutEffect(() => {
    openRepoPathsRef.current = openRepoPaths;
    activeRepoPathRef.current =
      activeRepoPath && activeWorkspaceId
        ? { workspaceId: activeWorkspaceId, repoPath: activeRepoPath }
        : null;
    eventsRef.current = events;
  }, [activeRepoPath, activeWorkspaceId, events, openRepoPaths]);

  const controllerRef = useRef<TaskStreamController | null>(null);
  const previousOpenRepoPathsRef = useRef<readonly WorkspaceRef[]>([]);
  useEffect(() => {
    const open = new Set(openRepoPaths.map(workspaceScopeKey));
    for (const repoPath of previousOpenRepoPathsRef.current) {
      if (open.has(workspaceScopeKey(repoPath))) continue;
      eventsRef.current.onWorkspaceReleased?.(repoPath);
      void controllerRef.current?.releaseWorkspace(repoPath);
    }
    previousOpenRepoPathsRef.current = openRepoPaths;
  }, [openRepoPaths]);

  useEffect(() => {
    let active = true;
    const settleStart = eventsRef.current.trackStart?.();
    const controller = createController({
      queryClient,
      getOpenRepoPaths: () => openRepoPathsRef.current,
      getActiveRepoPath: () => activeRepoPathRef.current,
      onDegraded: (error) => eventsRef.current.onDegraded(summarizeTaskLoadError({ error })),
      onSnapshotStarted: (repoPath) => eventsRef.current.onSnapshotStarted?.(repoPath),
      onSnapshotFinished: (repoPath, succeeded) =>
        eventsRef.current.onSnapshotFinished?.(repoPath, succeeded),
      onWorkspaceFailures: (failures) =>
        eventsRef.current.onWorkspaceFailures(describeWorkspaceFailures(failures)),
    });
    controllerRef.current = controller;
    void controller.start().then(
      () => {
        if (active) settleStart?.("started");
      },
      (cause: unknown) => {
        if (!active) return;
        settleStart?.("unavailable");
        eventsRef.current.onUnavailable(cause);
      },
    );
    return () => {
      active = false;
      settleStart?.("stopped");
      controllerRef.current = null;
      void controller.stop();
    };
  }, [createController, queryClient]);

  return openRepoPaths;
}
