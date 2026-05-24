import type { AgentSkillReference } from "@openducktor/core";
import { Blocks } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const AGENT_CHAT_SKILL_REFERENCE_CHIP_BASE_CLASS_NAME = cn(
  badgeVariants({ variant: "secondary" }),
  "inline-flex h-6 items-center gap-1.5 rounded-full border border-purple-200 bg-purple-100 px-2.5 text-xs font-medium text-purple-800 dark:border-purple-800 dark:bg-purple-950/50 dark:text-purple-200",
);

export const AGENT_CHAT_SKILL_REFERENCE_CHIP_ICON_CLASS_NAME = "inline-flex shrink-0";
export const AGENT_CHAT_SKILL_REFERENCE_CHIP_LABEL_CLASS_NAME = "truncate";

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
        ${skill.name}
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

export const getAgentChatSkillReferenceIconMarkup = (className = "size-3.5"): string => {
  const classes = ["lucide", "lucide-blocks", className].filter(Boolean).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${classes}" aria-hidden="true"><path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2"></path><rect x="14" y="2" width="8" height="8" rx="1"></rect></svg>`;
};
