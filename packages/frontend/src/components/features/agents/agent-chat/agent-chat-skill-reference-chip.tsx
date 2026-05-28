import type { AgentSkillReference } from "@openducktor/core";
import { Blocks } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  AGENT_CHAT_SKILL_REFERENCE_CHIP_BASE_CLASS_NAME,
  AGENT_CHAT_SKILL_REFERENCE_CHIP_ICON_CLASS_NAME,
  AGENT_CHAT_SKILL_REFERENCE_CHIP_LABEL_CLASS_NAME,
} from "./agent-chat-skill-reference-chip-markup";

type AgentChatInlineSkillReferenceChipProps = Omit<ComponentProps<typeof Badge>, "children"> & {
  skill: AgentSkillReference;
  [dataAttribute: `data-${string}`]: string | undefined;
};

type AgentChatSkillReferenceChipProps = {
  skill: AgentSkillReference;
  className?: string;
};

export function AgentChatInlineSkillReferenceChip({
  skill,
  className,
  title,
  ...props
}: AgentChatInlineSkillReferenceChipProps): ReactElement {
  return (
    <Badge
      variant="secondary"
      className={cn(AGENT_CHAT_SKILL_REFERENCE_CHIP_BASE_CLASS_NAME, "max-w-full", className)}
      title={title}
      {...props}
    >
      <span className={AGENT_CHAT_SKILL_REFERENCE_CHIP_ICON_CLASS_NAME} title={title}>
        <Blocks className="size-3.5" />
      </span>
      <span className={AGENT_CHAT_SKILL_REFERENCE_CHIP_LABEL_CLASS_NAME} title={title}>
        {skill.name}
      </span>
    </Badge>
  );
}

export function AgentChatSkillReferenceChip({
  skill,
  className,
}: AgentChatSkillReferenceChipProps): ReactElement {
  return (
    <AgentChatInlineSkillReferenceChip
      skill={skill}
      title={skill.displayName ?? skill.title ?? skill.name}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
