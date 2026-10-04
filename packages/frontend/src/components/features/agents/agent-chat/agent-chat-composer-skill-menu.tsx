import type { AgentSkillReference } from "@openducktor/core";
import { Blocks, ChevronRight, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import {
  AgentChatComposerMenu,
  AgentChatComposerMenuEmptyState,
  AgentChatComposerMenuRow,
} from "./agent-chat-composer-menu";
import { getComposerPopupOptionId } from "./agent-chat-composer-menu-state";

type AgentChatComposerSkillMenuProps = {
  listboxId: string;
  skills: AgentSkillReference[];
  activeIndex: number;
  skillsError: string | null;
  isSkillsLoading: boolean;
  onRetry: (() => void) | null;
  onSelectSkill: (skill: AgentSkillReference) => void;
};

export function AgentChatComposerSkillMenu({
  listboxId,
  skills,
  activeIndex,
  skillsError,
  isSkillsLoading,
  onRetry,
  onSelectSkill,
}: AgentChatComposerSkillMenuProps): ReactElement {
  return (
    <AgentChatComposerMenu
      listboxId={listboxId}
      label="Skills"
      activeIndex={activeIndex}
      items={skills}
      isBusy={isSkillsLoading && skills.length === 0}
      feedback={
        <>
          {isSkillsLoading ? (
            <div
              role="status"
              className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin" />
              <span>Loading skills</span>
            </div>
          ) : null}
          {skillsError ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm text-destructive"
            >
              <span className="min-w-0">{skillsError}</span>
              {onRetry ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 shrink-0 px-2"
                  onClick={onRetry}
                >
                  Retry
                </Button>
              ) : null}
            </div>
          ) : null}
          {skills.length === 0 && !isSkillsLoading && !skillsError ? (
            <AgentChatComposerMenuEmptyState title="No skills found." />
          ) : null}
        </>
      }
    >
      {skills.map((skill, index) => (
        <AgentChatComposerMenuRow
          key={skill.id}
          optionId={getComposerPopupOptionId(listboxId, index)}
          isActive={index === activeIndex}
          onSelect={() => onSelectSkill(skill)}
        >
          <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-950/50 dark:text-purple-200">
            <Blocks className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground">
              ${skill.name}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {skillLabel(skill)}
            </span>
            {skill.description ? (
              <span className="line-clamp-2 text-xs text-muted-foreground">
                {skill.description}
              </span>
            ) : null}
          </span>
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        </AgentChatComposerMenuRow>
      ))}
    </AgentChatComposerMenu>
  );
}

function skillLabel(skill: AgentSkillReference): string {
  return skill.displayName ?? skill.title ?? skill.name;
}
