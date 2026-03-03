import { useCallback } from "react";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

type SessionStartedToastActionProps = {
  intent: KanbanSessionStartIntent;
  sessionId: string;
  onOpen: (intent: KanbanSessionStartIntent, sessionId: string) => void;
};

function SessionStartedToastAction({ intent, sessionId, onOpen }: SessionStartedToastActionProps) {
  const handleOpen = useCallback(() => {
    onOpen(intent, sessionId);
  }, [intent, onOpen, sessionId]);

  return (
    <button
      type="button"
      className="w-fit cursor-pointer p-0 text-sm font-medium text-foreground underline underline-offset-2"
      onClick={handleOpen}
    >
      Open in Agent Studio
    </button>
  );
}

export const buildSessionStartedToastDescription = (
  intent: KanbanSessionStartIntent,
  sessionId: string,
  onOpen: (intent: KanbanSessionStartIntent, sessionId: string) => void,
) => {
  return <SessionStartedToastAction intent={intent} sessionId={sessionId} onOpen={onOpen} />;
};
