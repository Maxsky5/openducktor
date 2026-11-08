import { Target } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  AGENT_CHAT_GOAL_CHIP_CLASS_NAME,
  AGENT_CHAT_GOAL_CHIP_LABEL,
} from "./agent-chat-goal-chip-markup";

/** Shows the `/goal` command of a user message as a goal chip. */
export function AgentChatGoalChip({ className }: { className?: string }): ReactElement {
  return (
    <span className={cn(AGENT_CHAT_GOAL_CHIP_CLASS_NAME, className)}>
      <Target className="size-3.5 shrink-0" aria-hidden="true" />
      {AGENT_CHAT_GOAL_CHIP_LABEL}
    </span>
  );
}
