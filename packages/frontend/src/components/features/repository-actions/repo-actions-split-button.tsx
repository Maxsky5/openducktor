import type { RepoAction, RepoActions } from "@openducktor/contracts";
import { type LucideIcon, Plus, Settings2, TriangleAlert } from "lucide-react";
import { type ReactElement, useState } from "react";
import {
  SessionActionButton,
  SessionActionMenuTrigger,
} from "@/components/features/agents/session-action-button";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { REPO_ACTION_ICONS } from "./repo-action-icons";

type Props = {
  actions: RepoActions;
  /** Why the session cannot run an action, or null when it can. */
  disabledReason: string | null;
  onRunAction: (action: RepoAction) => void;
  onManageActions: () => void;
};

export function RepoActionsSplitButton({
  actions,
  disabledReason,
  onRunAction,
  onManageActions,
}: Props): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false);
  const split = splitActions(actions);
  if (split.kind === "empty") return <AddActionButton onClick={onManageActions} />;
  if (split.kind === "missing_default") {
    return <MissingDefaultActionButton onClick={onManageActions} />;
  }
  const { defaultAction, otherActions } = split;
  const isDisabled = disabledReason !== null;
  const DefaultIcon = REPO_ACTION_ICONS[defaultAction.icon].icon;
  const runLabel = `Run ${defaultAction.name}`;
  const selectMenuEntry = (select: () => void): void => {
    setMenuOpen(false);
    select();
  };
  return (
    <div role="group" aria-label="Repository actions" className="flex items-center">
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <SessionActionButton
              variant="outline"
              className="w-7 px-0"
              aria-label={runLabel}
              disabled={isDisabled}
              onClick={() => onRunAction(defaultAction)}
            >
              <DefaultIcon className="size-3.5" aria-hidden="true" />
            </SessionActionButton>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          {disabledReason ?? runLabel}
        </TooltipContent>
      </Tooltip>
      <Popover open={menuOpen && !isDisabled} onOpenChange={setMenuOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <PopoverTrigger asChild>
                <SessionActionMenuTrigger
                  variant="outline"
                  aria-label="More actions"
                  disabled={isDisabled}
                />
              </PopoverTrigger>
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-64">
            {disabledReason ?? "More actions"}
          </TooltipContent>
        </Tooltip>
        <PopoverContent align="end" aria-label="Repository actions" className="w-56 p-1.5">
          {otherActions.map((action) => (
            <MenuEntry
              key={action.id}
              icon={REPO_ACTION_ICONS[action.icon].icon}
              label={action.name}
              onSelect={() => selectMenuEntry(() => onRunAction(action))}
            />
          ))}
          {otherActions.length > 0 ? (
            <hr className="-mx-1.5 my-1.5 h-px border-0 bg-border" />
          ) : null}
          <MenuEntry
            icon={Settings2}
            label="Manage actions"
            onSelect={() => selectMenuEntry(onManageActions)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function MenuEntry({
  icon: Icon,
  label,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="w-full justify-start"
      onClick={onSelect}
    >
      <Icon aria-hidden="true" />
      <span className="truncate">{label}</span>
    </Button>
  );
}

function AddActionButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs shadow-none"
          aria-label="Add action"
          onClick={onClick}
        >
          <Plus className="size-3.5" aria-hidden="true" />
          <span className="@max-[640px]/session-header:hidden">Add action</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        Add a command that you can run from this bar.
      </TooltipContent>
    </Tooltip>
  );
}

const MISSING_DEFAULT_ACTION_MESSAGE =
  "The default action no longer exists. Choose a default action in the repository actions.";

// Saved settings always name an existing default action. This state shows a broken config instead
// of a run button that cannot work.
function MissingDefaultActionButton({ onClick }: { onClick: () => void }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs text-destructive shadow-none"
          aria-label={`Fix repository actions. ${MISSING_DEFAULT_ACTION_MESSAGE}`}
          onClick={onClick}
        >
          <TriangleAlert className="size-3.5" aria-hidden="true" />
          <span className="@max-[640px]/session-header:hidden">Fix actions</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-64">
        {MISSING_DEFAULT_ACTION_MESSAGE}
      </TooltipContent>
    </Tooltip>
  );
}

type SplitActions =
  | { kind: "empty" }
  | { kind: "missing_default" }
  | { kind: "ready"; defaultAction: RepoAction; otherActions: RepoAction[] };

function splitActions({ items, defaultActionId }: RepoActions): SplitActions {
  if (items.length === 0) return { kind: "empty" };
  const defaultAction = items.find((action) => action.id === defaultActionId);
  if (!defaultAction) return { kind: "missing_default" };
  return {
    kind: "ready",
    defaultAction,
    otherActions: items.filter((action) => action.id !== defaultAction.id),
  };
}
