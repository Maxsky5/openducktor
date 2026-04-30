import { Button } from "@/components/ui/button";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

export const renderSessionStartedToastAction = (
  intent: KanbanSessionStartIntent,
  externalSessionId: string,
  onOpen: (intent: KanbanSessionStartIntent, externalSessionId: string) => void,
) => {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-fit p-0 text-sm font-medium text-primary underline underline-offset-2 hover:bg-transparent hover:text-primary/90"
      onClick={() => onOpen(intent, externalSessionId)}
    >
      Open in Agent Studio
    </Button>
  );
};
