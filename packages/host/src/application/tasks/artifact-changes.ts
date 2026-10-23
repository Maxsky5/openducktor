import {
  workflowArtifactId,
  type TaskArtifactChange,
  type WorkflowArtifactKind,
} from "@openducktor/contracts";

export const workflowArtifactChange = (
  taskId: string,
  kind: WorkflowArtifactKind,
  removed = false,
): TaskArtifactChange => {
  const artifactId = workflowArtifactId(taskId, kind);
  return { taskId, artifactIds: [artifactId], removedArtifactIds: removed ? [artifactId] : [] };
};

export const removedArtifactChanges = (
  taskId: string,
  artifactIds: string[],
): TaskArtifactChange[] =>
  artifactIds.length ? [{ taskId, artifactIds, removedArtifactIds: artifactIds }] : [];
