import type { WorkspaceRecord } from "@openducktor/contracts";
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
  onSnapshotStarted?: (repoPath: string) => void;
  onSnapshotFinished?: (repoPath: string, succeeded: boolean) => void;
  /** Runs before the stream releases the task data of a workspace that closed. */
  onWorkspaceReleased?: (repoPath: string) => void;
  /**
   * Runs before each controller starts. The function that it returns receives how the start of
   * that controller ended.
   */
  trackStart?: () => (start: TaskStreamStart) => void;
};

const describeWorkspaceFailures = (failures: ReadonlyMap<string, unknown>): string =>
  [...failures]
    .map(([repoPath, error]) => `${repoPath}: ${summarizeTaskLoadError({ error })}`)
    .join("\n");

/**
 * Runs the task stream of the host connection. Task changes from this client, other clients, and
 * agents then reach the cached task lists, documents, and session lists of the open workspaces.
 * The task lists of all open workspaces stay cached, so a workspace switch shows its list at once.
 * A workspace that closes drops its cached task data. The events read their latest callbacks, so
 * a new callback does not restart the stream. Returns the repository paths of the open workspaces.
 */
export function useHostTaskStream({
  openWorkspaces,
  activeRepoPath,
  createController,
  events,
}: {
  openWorkspaces: readonly Pick<WorkspaceRecord, "repoPath">[];
  activeRepoPath: string | null;
  createController: TaskStreamControllerFactory;
  events: HostTaskStreamEvents;
}): readonly string[] {
  const queryClient = useQueryClient();
  const openRepoPaths = useOpenWorkspaceTaskLists({ openWorkspaces, activeRepoPath });
  const openRepoPathsRef = useRef(openRepoPaths);
  const activeRepoPathRef = useRef(activeRepoPath);
  const eventsRef = useRef(events);
  useLayoutEffect(() => {
    openRepoPathsRef.current = openRepoPaths;
    activeRepoPathRef.current = activeRepoPath;
    eventsRef.current = events;
  }, [activeRepoPath, events, openRepoPaths]);

  const controllerRef = useRef<TaskStreamController | null>(null);
  const previousOpenRepoPathsRef = useRef<readonly string[]>([]);
  useEffect(() => {
    const open = new Set(openRepoPaths);
    for (const repoPath of previousOpenRepoPathsRef.current) {
      if (open.has(repoPath)) continue;
      eventsRef.current.onWorkspaceReleased?.(repoPath);
      void controllerRef.current?.releaseWorkspace(repoPath);
    }
    previousOpenRepoPathsRef.current = openRepoPaths;
  }, [openRepoPaths]);

  useEffect(() => {
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
      () => settleStart?.("started"),
      (cause: unknown) => {
        settleStart?.("unavailable");
        eventsRef.current.onUnavailable(cause);
      },
    );
    return () => {
      settleStart?.("stopped");
      controllerRef.current = null;
      void controller.stop();
    };
  }, [createController, queryClient]);

  return openRepoPaths;
}
