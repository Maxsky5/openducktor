import { workflowArtifactId, type TaskArtifactChange } from "@openducktor/contracts";

export const workflowArtifactChange = (
  taskId: string,
  code: string,
  removed = false,
): TaskArtifactChange => {
  const artifactId = workflowArtifactId(taskId, code);
  return { taskId, artifactIds: [artifactId], removedArtifactIds: removed ? [artifactId] : [] };
};

export const removedArtifactChanges = (
  taskId: string,
  artifactIds: string[],
): TaskArtifactChange[] =>
  artifactIds.length ? [{ taskId, artifactIds, removedArtifactIds: artifactIds }] : [];
