import type { WorkflowRoleId as AgentRole } from "@openducktor/workflows";
import { GitMerge, MessageCirclePlus, Zap } from "lucide-react";
import type { ReactElement } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SessionActionButton, SessionActionMenuTrigger } from "./session-action-button";
import type {
  AgentWorkflowStep,
  AgentSessionCreateOption,
  AgentStudioQuickActionOption,
  AgentStudioTaskQuickActionOption,
} from "./agent-studio-header.types";
import {
  canRunPrimaryQuickAction,
  getQuickActionBlockedReason,
  isGitConflictResolutionQuickAction,
} from "./agent-studio-header-quick-actions-availability";

type QuickActionsMenuProps = {
  canOpenActionsMenu: boolean;
  workflowSteps: readonly AgentWorkflowStep[];
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  agentStudioReady: boolean;
  isCreatingSession: boolean;
  options: AgentStudioQuickActionOption[];
  primaryAction: AgentStudioQuickActionOption | null;
  sessionCreateOptions: AgentSessionCreateOption[];
  onQuickAction: (option: AgentStudioQuickActionOption) => void;
  onPrepareMessageFirstSession: (option: AgentSessionCreateOption) => void;
  onResolveGitConflictQuickAction: (() => void) | null;
};

type QuickActionCommandItemProps = {
  entry: QuickActionMenuEntry;
  disabledReason: string | null;
  onSelect: (entry: QuickActionMenuEntry) => void;
};

type QuickActionMenuEntry =
  | { kind: "quick_action"; option: AgentStudioQuickActionOption }
  | { kind: "message_first"; option: AgentSessionCreateOption };

/** Task actions have their own group. Session actions group by role. */
type QuickActionGroupKey = AgentRole | "task";

type QuickActionMenuGroup = {
  key: QuickActionGroupKey;
  entries: QuickActionMenuEntry[];
  label: string;
};

const quickActionEntryId = (entry: QuickActionMenuEntry): string =>
  `${entry.kind}:${entry.option.id}`;

const quickActionEntryGroup = (entry: QuickActionMenuEntry): QuickActionGroupKey => {
  if (entry.kind === "message_first") return `role:${entry.option.role}`;
  return entry.option.kind === "task_action" ? "task" : `role:${entry.option.role}`;
};

const getEntryDisabledReason = (
  entry: QuickActionMenuEntry,
  agentStudioReady: boolean,
  sessionStartBlockedReason: string | null,
  onResolveGitConflictQuickAction: (() => void) | null,
): string | null => {
  if (entry.kind === "quick_action") {
    return getQuickActionBlockedReason({
      option: entry.option,
      agentStudioReady,
      sessionStartBlockedReason,
      onResolveGitConflictQuickAction,
    });
  }

  if (!agentStudioReady) {
    return "The task session view is not ready.";
  }

  if (sessionStartBlockedReason) {
    return sessionStartBlockedReason;
  }

  if (entry.option.disabled) {
    return entry.option.disabledReason ?? "Action unavailable.";
  }

  return null;
};

const buildQuickActionMenuEntries = (
  options: AgentStudioQuickActionOption[],
  sessionCreateOptions: AgentSessionCreateOption[],
): QuickActionMenuEntry[] => [
  ...options.map((option) => ({ kind: "quick_action" as const, option })),
  ...sessionCreateOptions.map((option) => ({ kind: "message_first" as const, option })),
];

const buildQuickActionMenuGroups = (
  entries: QuickActionMenuEntry[],
  steps: readonly AgentWorkflowStep[],
): QuickActionMenuGroup[] => {
  const groups: QuickActionMenuGroup[] = [
    { key: "task", label: "Task", entries: [] },
    ...steps.flatMap((step) =>
      step.role
        ? [
            {
              key: `role:${step.role}`,
              label: step.label,
              entries: new Array<QuickActionMenuEntry>(),
            },
          ]
        : [],
    ),
  ];
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  for (const entry of entries) {
    const key = quickActionEntryGroup(entry);
    const group = groupByKey.get(key);
    if (!group)
      throw new Error(
        `Quick action group "${key}" is not declared by this workflow. Reload the task.`,
      );
    group.entries.push(entry);
  }
  return groups.filter(({ entries }) => entries.length > 0);
};

function QuickActionCommandItem({
  entry,
  disabledReason,
  onSelect,
}: QuickActionCommandItemProps): ReactElement {
  const { option } = entry;
  const isDisabled = option.disabled || disabledReason !== null;
  const description = disabledReason ?? option.disabledReason ?? option.description;
  const Icon = entry.kind === "message_first" ? MessageCirclePlus : Zap;

  return (
    <CommandItem
      disabled={isDisabled}
      value={option.label}
      onSelect={() => {
        onSelect(entry);
      }}
    >
      <Icon className="size-3.5 text-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{option.label}</p>
        {description ? (
          <p className="truncate text-[11px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </CommandItem>
  );
}

export function QuickActionsMenu({
  canOpenActionsMenu,
  workflowSteps,
  isOpen,
  onOpenChange,
  agentStudioReady,
  isCreatingSession,
  options,
  primaryAction,
  sessionCreateOptions,
  onQuickAction,
  onPrepareMessageFirstSession,
  onResolveGitConflictQuickAction,
}: QuickActionsMenuProps): ReactElement {
  const sessionStartBlockedReason = isCreatingSession
    ? "Session start is already in progress."
    : null;
  const canRunPrimaryAction = canRunPrimaryQuickAction({
    agentStudioReady,
    isCreatingSession,
    primaryAction,
    onResolveGitConflictQuickAction,
  });
  const menuEntries = buildQuickActionMenuEntries(options, sessionCreateOptions);
  const isMenuOpen = isOpen && canOpenActionsMenu;
  const groupedMenuEntries = buildQuickActionMenuGroups(menuEntries, workflowSteps);
  const primaryActionHint = primaryAction
    ? (getQuickActionBlockedReason({
        option: primaryAction,
        agentStudioReady,
        sessionStartBlockedReason,
        onResolveGitConflictQuickAction,
      }) ?? primaryAction.label)
    : "No quick action is available for this task.";

  const selectMenuEntry = (entry: QuickActionMenuEntry): void => {
    if (
      getEntryDisabledReason(
        entry,
        agentStudioReady,
        sessionStartBlockedReason,
        onResolveGitConflictQuickAction,
      )
    ) {
      return;
    }

    if (entry.kind === "message_first") {
      onPrepareMessageFirstSession(entry.option);
      onOpenChange(false);
      return;
    }

    if (isGitConflictResolutionQuickAction(entry.option)) {
      onResolveGitConflictQuickAction?.();
      onOpenChange(false);
      return;
    }

    onQuickAction(entry.option);
    onOpenChange(false);
  };

  // The merged Close Task proposal stays in the options also when another action leads.
  const mergedTarget = options.find(
    (option): option is AgentStudioTaskQuickActionOption =>
      option.kind === "task_action" && option.mergedTarget !== undefined,
  )?.mergedTarget;

  return (
    <div className="flex items-center gap-0">
      {mergedTarget ? (
        <Badge
          variant="success"
          className="mr-2 h-6 gap-1 rounded-full px-2 text-[11px] @max-[640px]/session-header:hidden"
          data-testid="agent-studio-merged-marker"
        >
          <GitMerge className="size-3" aria-hidden="true" />
          Merged into {mergedTarget}
        </Badge>
      ) : null}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <SessionActionButton
              disabled={!canRunPrimaryAction}
              aria-label={
                primaryAction
                  ? `Run quick action: ${primaryAction.label}`
                  : "Run primary quick action"
              }
              onClick={() => {
                if (primaryAction) {
                  selectMenuEntry({ kind: "quick_action", option: primaryAction });
                }
              }}
            >
              <Zap className="size-3.5" aria-hidden="true" />
              <span className="truncate @max-[640px]/session-header:hidden">
                {primaryAction?.label ?? "Actions"}
              </span>
            </SessionActionButton>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-64">
          {primaryActionHint}
        </TooltipContent>
      </Tooltip>
      <Popover open={isMenuOpen} onOpenChange={onOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <SessionActionMenuTrigger
                disabled={!canOpenActionsMenu}
                aria-label="Open quick actions menu"
              />
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Quick actions</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-96 p-0">
          <Command>
            <CommandInput
              aria-label="Filter quick actions"
              placeholder="Filter actions…"
              className="h-9"
            />
            <CommandList className="max-h-[32rem]">
              <CommandEmpty>No quick actions available.</CommandEmpty>
              {groupedMenuEntries.map((group) => (
                <CommandGroup key={group.key} heading={group.label}>
                  {group.entries.map((entry) => (
                    <QuickActionCommandItem
                      key={quickActionEntryId(entry)}
                      entry={entry}
                      disabledReason={getEntryDisabledReason(
                        entry,
                        agentStudioReady,
                        sessionStartBlockedReason,
                        onResolveGitConflictQuickAction,
                      )}
                      onSelect={selectMenuEntry}
                    />
                  ))}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
