import type { AgentRole } from "@openducktor/core";
import { ChevronDown, MessageCirclePlus, Zap } from "lucide-react";
import { type ReactElement, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type {
  AgentSessionCreateOption,
  AgentStudioQuickActionOption,
} from "./agent-studio-header.types";

type QuickActionsMenuProps = {
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

type QuickActionMenuGroup = {
  role: AgentRole;
  entries: QuickActionMenuEntry[];
};

const QUICK_ACTION_ROLE_ORDER: AgentRole[] = ["spec", "planner", "build", "qa"];

const QUICK_ACTION_ROLE_LABELS: Record<AgentRole, string> = {
  spec: "Spec",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
};

const isGitConflictResolutionQuickAction = (option: AgentStudioQuickActionOption): boolean => {
  return option.launchActionId === "build_rebase_conflict_resolution";
};

const quickActionEntryId = (entry: QuickActionMenuEntry): string =>
  `${entry.kind}:${entry.option.id}`;

const quickActionEntryRole = (entry: QuickActionMenuEntry): AgentRole => entry.option.role;

const getEntryDisabledReason = (
  entry: QuickActionMenuEntry,
  agentStudioReady: boolean,
  sessionStartBlockedReason: string | null,
  onResolveGitConflictQuickAction: (() => void) | null,
): string | null => {
  if (!agentStudioReady) {
    return "Agent Studio is not ready.";
  }

  if (sessionStartBlockedReason) {
    return sessionStartBlockedReason;
  }

  if (entry.option.disabled) {
    return entry.option.disabledReason ?? "Action unavailable.";
  }

  if (entry.kind === "quick_action" && isGitConflictResolutionQuickAction(entry.option)) {
    if (!onResolveGitConflictQuickAction) {
      return "Git conflict resolution is unavailable.";
    }
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

const buildQuickActionMenuGroups = (entries: QuickActionMenuEntry[]): QuickActionMenuGroup[] => {
  const entriesByRole: Record<AgentRole, QuickActionMenuEntry[]> = {
    spec: [],
    planner: [],
    build: [],
    qa: [],
  };
  const groups: QuickActionMenuGroup[] = [];

  for (const entry of entries) {
    entriesByRole[quickActionEntryRole(entry)].push(entry);
  }

  for (const role of QUICK_ACTION_ROLE_ORDER) {
    const roleEntries = entriesByRole[role];
    if (roleEntries.length > 0) {
      groups.push({ role, entries: roleEntries });
    }
  }

  return groups;
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
        <p className="truncate text-[11px] text-muted-foreground">{description}</p>
      </div>
    </CommandItem>
  );
}

export function QuickActionsMenu({
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
  const triggerTitle = primaryAction ? `Quick actions · ${primaryAction.label}` : "Quick actions";
  const sessionStartBlockedReason = isCreatingSession
    ? "Session start is already in progress."
    : null;
  const canRunPrimaryAction =
    primaryAction !== null &&
    getEntryDisabledReason(
      { kind: "quick_action", option: primaryAction },
      agentStudioReady,
      sessionStartBlockedReason,
      onResolveGitConflictQuickAction,
    ) === null;
  const menuEntries = buildQuickActionMenuEntries(options, sessionCreateOptions);
  const primaryActionDisabled = primaryAction !== null && !canRunPrimaryAction;
  const canOpenActionsMenu = agentStudioReady && menuEntries.length > 0 && !primaryActionDisabled;
  const groupedMenuEntries = buildQuickActionMenuGroups(menuEntries);
  const onOpenChangeRef = useRef(onOpenChange);

  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  }, [onOpenChange]);

  useEffect(() => {
    if (isOpen && !canOpenActionsMenu) {
      onOpenChangeRef.current(false);
    }
  }, [canOpenActionsMenu, isOpen]);

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

  return (
    <div className="flex items-center gap-0">
      <Button
        type="button"
        variant="accent"
        size="sm"
        className="h-9 max-w-48 gap-2 rounded-r-none px-3"
        disabled={!canRunPrimaryAction}
        title={triggerTitle}
        aria-label={
          primaryAction ? `Run quick action: ${primaryAction.label}` : "Run primary quick action"
        }
        onClick={() => {
          if (primaryAction) {
            selectMenuEntry({ kind: "quick_action", option: primaryAction });
          }
        }}
      >
        <Zap className="size-4 text-amber-400 dark:text-amber-500" />
        <span className="truncate">{primaryAction?.label ?? "Actions"}</span>
      </Button>
      <Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="accent"
            size="sm"
            className="h-9 rounded-l-none border-l border-sidebar-border/70 px-2"
            disabled={!canOpenActionsMenu}
            title="Open quick actions menu"
            aria-label="Open quick actions menu"
          >
            <ChevronDown className="size-3.5 opacity-80" />
          </Button>
        </PopoverTrigger>
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
                <CommandGroup key={group.role} heading={QUICK_ACTION_ROLE_LABELS[group.role]}>
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
