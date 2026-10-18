import {
  type AppPlatform,
  type IssueType,
  issueTypeSchema,
  type TaskPriority,
} from "@openducktor/contracts";
import { Blocks, Flag, Tag, X } from "lucide-react";
import {
  type ReactElement,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  KanbanFilterMenu,
  type KanbanFilterOption,
} from "@/components/features/kanban/kanban-filter-menu";
import {
  ISSUE_TYPE_STYLES,
  PRIORITY_LEVELS,
  PRIORITY_STYLES,
} from "@/components/features/kanban/kanban-task-badge-model";
import { Button } from "@/components/ui/button";
import { hasOpenDialog } from "@/components/ui/open-dialogs";
import { ToolbarSearchField } from "@/components/ui/search-field";
import { isPlatformChord } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";
import { readDevicePlatform } from "@/lib/device-platform";
import type { KanbanBoardFilterModel } from "./kanban-page-model-types";

type KanbanBoardFilterBarProps = {
  filter: KanbanBoardFilterModel;
};

/**
 * The board search field, the Labels, Type, and Priority menus, and Clear.
 * Mod+F moves focus to the search field, unless a dialog or sheet is open.
 */
export function KanbanBoardFilterBar({ filter }: KanbanBoardFilterBarProps): ReactElement {
  const searchId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  // The shortcut follows the keys of this device, not the platform of the selected host.
  const [platform] = useState(readDevicePlatform);
  const onShortcut = useEffectEvent((event: KeyboardEvent, keyPlatform: AppPlatform): void => {
    if (!isPlatformChord(event, "f", keyPlatform) || filter.isDisabled || hasOpenDialog()) return;
    event.preventDefault();
    searchRef.current?.focus();
    searchRef.current?.select();
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => onShortcut(event, platform);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [platform]);
  const labelOptions = useMemo(
    () => filter.labelOptions.map((label) => ({ value: label, label })),
    [filter.labelOptions],
  );

  return (
    // The search field shrinks before the header wraps, so Clear does not push the board down.
    <div className="flex min-w-64 flex-1 basis-0 flex-wrap items-center gap-2">
      <div className="min-w-40 max-w-56 flex-1 basis-40">
        <ToolbarSearchField
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
        options={ISSUE_TYPE_OPTIONS}
        selected={filter.value.issueTypes}
        disabled={filter.isDisabled}
        onSelectedChange={(issueTypes) => filter.onChange({ issueTypes })}
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

/** The menus use the words of the card badges. */
const ISSUE_TYPE_OPTIONS: KanbanFilterOption<IssueType>[] = issueTypeSchema.options.map(
  (issueType) => {
    const { label, icon: Icon, iconClassName } = ISSUE_TYPE_STYLES[issueType];
    return { value: issueType, label, icon: <Icon className={cn("size-3.5", iconClassName)} /> };
  },
);

const PRIORITY_OPTIONS: KanbanFilterOption<TaskPriority>[] = PRIORITY_LEVELS.map((priority) => {
  const { label, hint, dotClassName } = PRIORITY_STYLES[priority];
  return {
    value: priority,
    label: `${label} ${hint}`,
    icon: <span className={cn("size-2 rounded-full", dotClassName)} />,
  };
});
