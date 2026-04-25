import type { ReactElement } from "react";
import { SessionStartModal, type SessionStartModalModel } from "@/components/features/agents";

type KanbanSessionStartModalProps = {
  model: SessionStartModalModel | null;
};

export function KanbanSessionStartModal({
  model,
}: KanbanSessionStartModalProps): ReactElement | null {
  if (!model) {
    return null;
  }

  return <SessionStartModal model={model} />;
}
