import { Button } from "@/components/ui/button";
import type { AgentSessionRouteIdentity } from "@/types/agent-orchestrator";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

export const renderSessionStartedToastAction = (
  intent: KanbanSessionStartIntent,
  session: AgentSessionRouteIdentity,
  onOpen: (intent: KanbanSessionStartIntent, session: AgentSessionRouteIdentity) => void,
) => {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-fit p-0 text-sm font-medium text-primary underline underline-offset-2 hover:bg-transparent hover:text-primary/90"
      onClick={() => onOpen(intent, session)}
    >
      Open in Agent Studio
    </Button>
  );
};
