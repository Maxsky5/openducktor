import type { AgentSessionLiveEnvelope, NotificationOccurrence } from "@openducktor/contracts";
import type {
  NotificationProducerFailure,
  NotificationTaskObserver,
  NotificationWorkspace,
} from "./notification-task-observer";
import { createSessionOccurrenceProjector } from "./session-occurrence-projector";

type Observation = {
  label: string;
  cancelled: boolean;
  stop: (() => void) | null;
};

export const createNotificationWorkspaceObserver = ({
  observe,
  taskObserver,
  publish,
  onFailure,
}: {
  observe(
    input: { repoPath: string },
    listener: (envelope: AgentSessionLiveEnvelope) => void,
  ): Promise<() => void>;
  taskObserver: NotificationTaskObserver;
  publish(occurrence: NotificationOccurrence): void;
  onFailure(failure: NotificationProducerFailure): void;
}) => {
  const observations = new Map<string, Observation>();
  let syncVersion = 0;

  const stopObservation = (repoPath: string): void => {
    const observation = observations.get(repoPath);
    if (!observation) {
      return;
    }
    observation.cancelled = true;
    observation.stop?.();
    observations.delete(repoPath);
  };

  const startObservation = (workspace: NotificationWorkspace): void => {
    const observation: Observation = {
      label: workspace.repositoryLabel,
      cancelled: false,
      stop: null,
    };
    observations.set(workspace.repoPath, observation);
    const projector = createSessionOccurrenceProjector({
      repositoryLabel: workspace.repositoryLabel,
      resolveAssociation: (ref) =>
        taskObserver.resolveSessionAssociation(ref.repoPath, ref.externalSessionId),
      resolveTask: (taskId) => taskObserver.resolveTask(workspace.repoPath, taskId),
    });

    void observe({ repoPath: workspace.repoPath }, (envelope) => {
      if (observation.cancelled) {
        return;
      }
      try {
        for (const occurrence of projector.accept(envelope)) {
          publish(occurrence);
        }
      } catch (cause) {
        onFailure({ repoPath: workspace.repoPath, source: "session", cause });
      }
    })
      .then((stop) => {
        if (observation.cancelled) {
          stop();
          return;
        }
        observation.stop = stop;
      })
      .catch((cause) => {
        if (!observation.cancelled) {
          onFailure({ repoPath: workspace.repoPath, source: "session", cause });
        }
      });
  };

  return {
    async syncWorkspaces(workspaces: readonly NotificationWorkspace[]): Promise<void> {
      const version = ++syncVersion;
      const nextRepoPaths = new Set(workspaces.map((workspace) => workspace.repoPath));
      for (const repoPath of observations.keys()) {
        if (!nextRepoPaths.has(repoPath)) {
          stopObservation(repoPath);
        }
      }
      await taskObserver.syncWorkspaces(workspaces);
      if (version !== syncVersion) {
        return;
      }
      for (const workspace of workspaces) {
        const current = observations.get(workspace.repoPath);
        if (current?.label === workspace.repositoryLabel) {
          continue;
        }
        if (current) {
          stopObservation(workspace.repoPath);
        }
        startObservation(workspace);
      }
    },
    dispose(): void {
      syncVersion += 1;
      for (const repoPath of observations.keys()) {
        stopObservation(repoPath);
      }
    },
  };
};
