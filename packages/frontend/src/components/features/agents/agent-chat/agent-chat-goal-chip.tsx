import { Target } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  AGENT_CHAT_GOAL_CHIP_CLASS_NAME,
  AGENT_CHAT_GOAL_CHIP_LABEL,
} from "./agent-chat-goal-chip-markup";
import {
  referenceChipClassName,
  type UserMessageReferenceChipSize,
} from "./agent-chat-user-message-reference-chip";

/** Shows the `/goal` command of a user message as a goal chip, at the size of the other chips. */
export function AgentChatGoalChip({
  size = "default",
}: {
  size?: UserMessageReferenceChipSize;
}): ReactElement {
  return (
    <span className={cn(AGENT_CHAT_GOAL_CHIP_CLASS_NAME, referenceChipClassName(size), "ml-0")}>
      <Target className="size-3.5 shrink-0" aria-hidden="true" />
      {AGENT_CHAT_GOAL_CHIP_LABEL}
    </span>
  );
}
