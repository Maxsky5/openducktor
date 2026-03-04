import { Button } from "@/components/ui/button";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

export const renderSessionStartedToastAction = (
  intent: KanbanSessionStartIntent,
  sessionId: string,
  onOpen: (intent: KanbanSessionStartIntent, sessionId: string) => void,
) => {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-fit p-0 text-sm font-medium text-foreground underline underline-offset-2 hover:bg-transparent"
      onClick={() => onOpen(intent, sessionId)}
    >
      Open in Agent Studio
    </Button>
  );
};
