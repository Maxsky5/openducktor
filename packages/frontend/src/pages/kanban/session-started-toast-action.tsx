import { Button } from "@/components/ui/button";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { KanbanSessionStartIntent } from "./kanban-page-model-types";

export const renderSessionStartedToastAction = (
  intent: KanbanSessionStartIntent,
  session: AgentSessionIdentity,
  onOpen: (intent: KanbanSessionStartIntent, session: AgentSessionIdentity) => void,
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
