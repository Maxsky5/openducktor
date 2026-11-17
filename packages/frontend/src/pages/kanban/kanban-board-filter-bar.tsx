import { issueTypeSchema, type TaskPriority } from "@openducktor/contracts";
import { Blocks, Flag, Tag, X } from "lucide-react";
import { type ReactElement, useId, useMemo, useRef } from "react";
import {
  KanbanFilterMenu,
  type KanbanFilterOption,
} from "@/components/features/kanban/kanban-filter-menu";
import { PRIORITY_LEVELS } from "@openducktor/frontend-core/tasks/board/kanban-task-badge-model";
import {
  issueTypeStyle,
  PRIORITY_STYLES,
} from "@/components/features/kanban/kanban-task-badge-model";
import { Button } from "@/components/ui/button";
import { useShortcutTitle } from "@/features/shortcuts/shortcut-controls";
import { useCommandPalettePageCommand } from "@/features/command-palette/command-palette-context";
import { ToolbarSearchField } from "@/components/ui/search-field";
import { cn } from "@/lib/utils";
import type { KanbanBoardFilterModel } from "@openducktor/frontend-core/tasks/board/use-kanban-board-filter-model";

type KanbanBoardFilterBarProps = {
  filter: KanbanBoardFilterModel;
};

/**
 * The board search field, the Labels, Type, and Priority menus, and Clear.
 * Mod+F moves focus to the search field, unless a dialog or sheet is open.
 */
export function KanbanBoardFilterBar({ filter }: KanbanBoardFilterBarProps): ReactElement {
  const searchId = useId();
  const searchTitle = useShortcutTitle("focus-task-search", "Search tasks", !filter.isDisabled);
  const searchRef = useRef<HTMLInputElement>(null);
  useCommandPalettePageCommand({
    id: "focus-task-search" as const,
    label: "Focus task search",
    icon: Blocks,
    keywords: ["search", "find tasks"],
    target: { kind: "app", key: "kanban-search" },
    disabledReason: () =>
      filter.isDisabled || !searchRef.current ? "Task search is unavailable." : null,
    run: () => {
      searchRef.current?.focus();
      searchRef.current?.select();
    },
  });
  const labelOptions = useMemo(
    () => filter.labelOptions.map((label) => ({ value: label, label })),
    [filter.labelOptions],
  );

  const issueTypeOptions = filter.issueTypeOptions.map((choice) => {
    const style = issueTypeStyle({ id: choice.value, label: choice.label, icon: choice.icon });
    const Icon = style.icon;
    return {
      ...choice,
      icon: <Icon aria-hidden="true" className={cn("size-3.5", style.iconClassName)} />,
    };
  });

  return (
    // The search field shrinks before the header wraps, so Clear does not push the board down.
    <div className="flex min-w-64 flex-1 basis-0 flex-wrap items-center gap-2">
      <div className="min-w-40 max-w-56 flex-1 basis-40">
        <ToolbarSearchField
          title={searchTitle}
          ref={searchRef}
          id={searchId}
          size="md"
          label="Search tasks"
          placeholder="Search tasks"
          value={filter.value.searchText}
          disabled={filter.isDisabled}
          onValueChange={(searchText) => filter.onChange({ searchText })}
        />
      </div>
      <KanbanFilterMenu
        name="Labels"
        icon={Tag}
        options={labelOptions}
        selected={filter.value.labels}
        disabled={filter.isDisabled}
        search={{ placeholder: "Search labels", emptyText: "No labels found." }}
        onSelectedChange={(labels) => filter.onChange({ labels })}
      />
      <KanbanFilterMenu
        name="Type"
        icon={Blocks}
        options={issueTypeOptions}
        selected={filter.value.issueTypes}
        disabled={filter.isDisabled}
        onSelectedChange={(issueTypes) =>
          filter.onChange({ issueTypes: issueTypes.map((value) => issueTypeSchema.parse(value)) })
        }
      />
      <KanbanFilterMenu
        name="Priority"
        icon={Flag}
        options={PRIORITY_OPTIONS}
        selected={filter.value.priorities}
        disabled={filter.isDisabled}
        onSelectedChange={(priorities) => filter.onChange({ priorities })}
      />
      {filter.isActive ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          onClick={() => {
            filter.onClear();
            // Clear hides itself, so focus moves to the search field.
            searchRef.current?.focus();
          }}
        >
          <X aria-hidden="true" className="size-3.5" />
          Clear
        </Button>
      ) : null}
    </div>
  );
}

const PRIORITY_OPTIONS: KanbanFilterOption<TaskPriority>[] = PRIORITY_LEVELS.map((priority) => {
  const { label, hint, dotClassName } = PRIORITY_STYLES[priority];
  return {
    value: priority,
    label: `${label} ${hint}`,
    icon: <span className={cn("size-2 rounded-full", dotClassName)} />,
  };
});
