import type { AgentSkillReference } from "@openducktor/core";
import { Blocks, ChevronRight, LoaderCircle } from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { getComposerPopupOptionId } from "./agent-chat-composer-menu-state";

type AgentChatComposerSkillMenuProps = {
  listboxId: string;
  skills: AgentSkillReference[];
  activeIndex: number;
  skillsError: string | null;
  isSkillsLoading: boolean;
  onSelectSkill: (skill: AgentSkillReference) => void;
};

const skillLabel = (skill: AgentSkillReference): string => {
  return skill.displayName ?? skill.title ?? skill.name;
};

export function AgentChatComposerSkillMenu({
  listboxId,
  skills,
  activeIndex,
  skillsError,
  isSkillsLoading,
  onSelectSkill,
}: AgentChatComposerSkillMenuProps): ReactElement {
  const skillButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const activeSkill = skills[activeIndex];
    if (!activeSkill) {
      return;
    }

    skillButtonRefs.current[activeSkill.id]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [activeIndex, skills]);

  return (
    <div className="absolute bottom-full z-20 mb-2 rounded-xl border border-border bg-popover shadow-lg">
      {isSkillsLoading ? (
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          <span>Loading skills</span>
        </div>
      ) : null}
      {skillsError ? (
        <div className="border-b border-border px-3 py-2 text-sm text-destructive">
          {skillsError}
        </div>
      ) : null}
      {skills.length === 0 && !isSkillsLoading && !skillsError ? (
        <div role="status" className="px-3 py-2 text-sm text-muted-foreground">
          No skills found.
        </div>
      ) : null}
      <div
        id={listboxId}
        role="listbox"
        aria-label="Skills"
        className="hide-scrollbar flex max-h-64 flex-col overflow-y-auto rounded-xl"
      >
        {skills.length > 0
          ? skills.map((skill, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  key={skill.id}
                  id={getComposerPopupOptionId(listboxId, index)}
                  ref={(element) => {
                    skillButtonRefs.current[skill.id] = element;
                  }}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  type="button"
                  className={cn(
                    "flex w-full cursor-pointer gap-3 px-3 py-2 text-left transition-colors",
                    isActive ? "bg-selected-surface" : "hover:bg-muted/80",
                  )}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    onSelectSkill(skill);
                  }}
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
                </button>
              );
            })
          : null}
      </div>
    </div>
  );
}
