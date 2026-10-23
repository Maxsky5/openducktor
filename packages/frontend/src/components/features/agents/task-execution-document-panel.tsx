import type { ReactElement } from "react";
import {
  TaskArtifactsView,
  type TaskArtifactsViewProps,
} from "@/components/features/task-artifacts/task-artifacts";

export type TaskExecutionDocumentPanelModel = TaskArtifactsViewProps;

export function TaskExecutionDocumentPanel({
  model,
}: {
  model: TaskExecutionDocumentPanelModel;
}): ReactElement {
  return <TaskArtifactsView {...model} />;
}
