import type { AgentSubagentReference } from "@openducktor/core";
import { Bot } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_BASE_CLASS_NAME,
  AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_ICON_CLASS_NAME,
  AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_LABEL_CLASS_NAME,
} from "./agent-chat-subagent-reference-chip-markup";

type AgentChatInlineSubagentReferenceChipProps = Omit<ComponentProps<typeof Badge>, "children"> & {
  subagent: AgentSubagentReference;
  [dataAttribute: `data-${string}`]: string | undefined;
};

type AgentChatSubagentReferenceChipProps = {
  subagent: AgentSubagentReference;
  className?: string;
};

const subagentLabel = (subagent: AgentSubagentReference): string => {
  return subagent.label ?? subagent.name;
};

function AgentChatInlineSubagentReferenceChip({
  subagent,
  className,
  title,
  ...props
}: AgentChatInlineSubagentReferenceChipProps): ReactElement {
  return (
    <Badge
      variant="secondary"
      className={cn(AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_BASE_CLASS_NAME, "max-w-full", className)}
      title={title}
      {...props}
    >
      <span className={AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_ICON_CLASS_NAME} title={title}>
        <Bot className="size-3.5" />
      </span>
      <span className={AGENT_CHAT_SUBAGENT_REFERENCE_CHIP_LABEL_CLASS_NAME} title={title}>
        {subagent.name}
      </span>
    </Badge>
  );
}

export function AgentChatSubagentReferenceChip({
  subagent,
  className,
}: AgentChatSubagentReferenceChipProps): ReactElement {
  return (
    <AgentChatInlineSubagentReferenceChip
      subagent={subagent}
      title={subagentLabel(subagent)}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
