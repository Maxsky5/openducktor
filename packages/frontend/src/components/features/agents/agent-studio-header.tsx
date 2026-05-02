import type { AgentRole } from "@openducktor/core";
import {
  AlertTriangle,
  ArrowUpRightFromSquare,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDotDashed,
  History,
  LoaderCircle,
  Sparkles,
  Zap,
} from "lucide-react";
import { type ReactElement, useMemo, useRef, useState } from "react";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import type { ComboboxGroup } from "@/components/ui/combobox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { SessionLaunchActionId, SessionStartPostAction } from "@/features/session-start";
import { cn } from "@/lib/utils";
import type { AgentWorkflowStepState } from "@/types/agent-workflow";
import type { AgentRoleOption } from "./agent-chat/agent-chat.types";

type AgentWorkflowStep = {
  role: AgentRole;
  label: string;
  icon: AgentRoleOption["icon"];
  state: AgentWorkflowStepState;
  externalSessionId: string | null;
};

type WorkflowStepAttentionVariant = "none" | "session_waiting_input" | "blocked_task";

type AgentStudioSessionSelectorModel = {
  value: string;
  groups: ComboboxGroup[];
  disabled: boolean;
  onValueChange: (value: string) => void;
  shouldAutofocusComposerForValue: (value: string) => boolean;
};

type AgentSessionCreateOption = {
  id: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  label: string;
  description: string;
  disabled: boolean;
  disabledReason?: string;
};

type AgentStudioQuickActionOption = {
  id: string;
  role: AgentRole;
  launchActionId: SessionLaunchActionId;
  label: string;
  description: string;
  postStartAction: SessionStartPostAction;
  disabled: boolean;
  disabledReason?: string;
};

export type AgentStudioHeaderModel = {
  taskTitle: string | null;
  taskId: string | null;
  onOpenTaskDetails: (() => void) | null;
  sessionStatus: "starting" | "running" | "idle" | "error" | "stopped" | null;
  selectedRole: AgentRole | null;
  workflowSteps: AgentWorkflowStep[];
  onWorkflowStepSelect: (role: AgentRole, externalSessionId: string | null) => void;
  sessionSelector: AgentStudioSessionSelectorModel;
  sessionCreateOptions: AgentSessionCreateOption[];
  onPrepareMessageFirstSession: (option: AgentSessionCreateOption) => void;
  quickActions: AgentStudioQuickActionOption[];
  primaryQuickAction: AgentStudioQuickActionOption | null;
  onQuickAction: (option: AgentStudioQuickActionOption) => void;
  onResolveGitConflictQuickAction: (() => void) | null;
  createSessionDisabled: boolean;
  isCreatingSession: boolean;
  agentStudioReady: boolean;
};

export const deriveSessionHistorySelectionFocusBehavior = (params: {
  currentValue: string;
  nextValue: string;
  shouldAutofocusComposerForValue: (value: string) => boolean;
}): "composer" | "trigger" | "none" => {
  if (params.nextValue === params.currentValue) {
    return "none";
  }

  return params.shouldAutofocusComposerForValue(params.nextValue) ? "composer" : "trigger";
};

const WORKFLOW_STEP_CLASSES: Record<AgentWorkflowStepState["tone"], string> = {
  in_progress: "border-info-border bg-info-surface hover:bg-info-surface text-info-muted shadow-sm",
  done: "border-success-border bg-success-surface hover:bg-success-surface text-success-muted shadow-sm",
  available: "border-input bg-card text-foreground",
  optional: "border-input bg-card text-foreground",
  rejected:
    "border-rejected-border bg-rejected-surface text-rejected-muted shadow-sm hover:bg-rejected-surface",
  waiting_input:
    "border-warning-border bg-warning-surface hover:bg-warning-surface text-warning-muted shadow-sm",
  failed:
    "border-destructive-border bg-destructive-surface hover:bg-destructive-surface text-destructive-muted shadow-sm",
  blocked: "border-border bg-muted text-muted-foreground",
};

const WORKFLOW_CONNECTOR_CLASSES: Record<AgentWorkflowStepState["tone"], string> = {
  done: "text-success-ring",
  in_progress: "text-info-ring",
  available: "text-muted-foreground/40",
  optional: "text-muted-foreground/40",
  rejected: "text-rejected-ring",
  waiting_input: "text-warning-ring",
  failed: "text-destructive-ring",
  blocked: "text-muted-foreground/20",
};

const WORKFLOW_SELECTION_CLASSES: Record<AgentWorkflowStepState["tone"], string> = {
  done: "ring-2 ring-offset-2 ring-offset-card ring-success-ring",
  in_progress: "ring-2 ring-offset-2 ring-offset-card ring-info-ring",
  available: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  optional: "ring-2 ring-offset-2 ring-offset-card ring-muted-foreground/50",
  rejected: "ring-2 ring-offset-2 ring-offset-card ring-rejected-ring",
  waiting_input: "ring-2 ring-offset-2 ring-offset-card ring-warning-ring",
  failed: "ring-2 ring-offset-2 ring-offset-card ring-destructive-ring",
  blocked: "ring-2 ring-offset-2 ring-offset-card ring-warning-ring",
};

const requireWorkflowToneClass = (
  classes: Record<AgentWorkflowStepState["tone"], string>,
  tone: AgentWorkflowStepState["tone"],
  context: string,
): string => {
  const className = classes[tone];
  if (!className) {
    throw new Error(`Unknown workflow tone for ${context}: ${tone}`);
  }
  return className;
};

const workflowStepClassName = (state: AgentWorkflowStepState): string =>
  requireWorkflowToneClass(WORKFLOW_STEP_CLASSES, state.tone, "workflow step");

const workflowConnectorClassName = (state: AgentWorkflowStepState): string =>
  requireWorkflowToneClass(WORKFLOW_CONNECTOR_CLASSES, state.tone, "workflow connector");

const workflowSelectionClassName = (isSelected: boolean, state: AgentWorkflowStepState): string => {
  if (!isSelected) {
    return "";
  }
  return requireWorkflowToneClass(WORKFLOW_SELECTION_CLASSES, state.tone, "workflow selection");
};

const workflowBorderStyleClassName = (state: AgentWorkflowStepState): string =>
  // Dashed styling is only for steps that are currently merely optional and available.
  state.tone === "optional" ? "border-dashed" : "";

const QUICK_ACTION_ROLE_ORDER: AgentRole[] = ["spec", "planner", "build", "qa"];

const QUICK_ACTION_ROLE_LABELS: Record<AgentRole, string> = {
  spec: "Spec",
  planner: "Planner",
  build: "Builder",
  qa: "QA",
};

const getWorkflowStepAttentionVariant = (
  entry: AgentWorkflowStep,
): WorkflowStepAttentionVariant => {
  if (entry.state.liveSession === "waiting_input") {
    return "session_waiting_input";
  }

  if (entry.role === "build" && entry.state.tone === "waiting_input") {
    return "blocked_task";
  }

  return "none";
};

const workflowStepHint = (entry: AgentWorkflowStep): string => {
  const attentionVariant = getWorkflowStepAttentionVariant(entry);

  if (attentionVariant === "session_waiting_input") {
    return "Session is waiting for input";
  }
  if (attentionVariant === "blocked_task") {
    return "Task is blocked and waiting for user action";
  }
  if (entry.state.liveSession === "running") {
    return "Step in progress";
  }
  if (entry.state.liveSession === "error") {
    return "Latest session failed";
  }
  if (entry.state.tone === "failed") {
    if (entry.externalSessionId) {
      return "Open latest failed session for this role";
    }
    return "Step failed before a session could start";
  }
  if (entry.state.completion === "rejected") {
    return "Latest review rejected this task";
  }
  if (entry.externalSessionId) {
    return "Open latest relevant session for this role";
  }
  if (entry.state.tone === "available") {
    return "No session yet for this role";
  }
  if (entry.state.tone === "optional") {
    return "Optional step for this task";
  }
  return "Blocked by workflow state";
};

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

const isGitConflictResolutionQuickAction = (option: AgentStudioQuickActionOption): boolean => {
  return option.launchActionId === "build_rebase_conflict_resolution";
};

type QuickActionCommandItemProps = {
  entry: QuickActionMenuEntry;
  disabledReason: string | null;
  onSelect: (entry: QuickActionMenuEntry) => void;
};

type QuickActionMenuEntry =
  | { kind: "quick_action"; option: AgentStudioQuickActionOption }
  | { kind: "message_first"; option: AgentSessionCreateOption };

const quickActionEntryId = (entry: QuickActionMenuEntry): string =>
  `${entry.kind}:${entry.option.id}`;

const quickActionEntryRole = (entry: QuickActionMenuEntry): AgentRole => entry.option.role;

function QuickActionCommandItem({
  entry,
  disabledReason,
  onSelect,
}: QuickActionCommandItemProps): ReactElement {
  const { option } = entry;
  const isDisabled = option.disabled || disabledReason !== null;
  const description = disabledReason ?? option.disabledReason ?? option.description;
  const Icon = entry.kind === "message_first" ? Sparkles : Zap;

  return (
    <CommandItem
      disabled={isDisabled}
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

function QuickActionsMenu({
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
    agentStudioReady &&
    primaryAction !== null &&
    !primaryAction.disabled &&
    sessionStartBlockedReason === null;
  const menuEntries = useMemo<QuickActionMenuEntry[]>(
    () => [
      ...options.map((option) => ({ kind: "quick_action" as const, option })),
      ...sessionCreateOptions.map((option) => ({ kind: "message_first" as const, option })),
    ],
    [options, sessionCreateOptions],
  );
  const canOpenActionsMenu = agentStudioReady && menuEntries.length > 0;
  const groupedMenuEntries = useMemo(() => {
    const entriesByRole: Record<AgentRole, QuickActionMenuEntry[]> = {
      spec: [],
      planner: [],
      build: [],
      qa: [],
    };
    const groups: { role: AgentRole; entries: QuickActionMenuEntry[] }[] = [];

    for (const entry of menuEntries) {
      entriesByRole[quickActionEntryRole(entry)].push(entry);
    }
    for (const role of QUICK_ACTION_ROLE_ORDER) {
      const entries = entriesByRole[role];
      if (entries.length > 0) {
        groups.push({ role, entries });
      }
    }
    return groups;
  }, [menuEntries]);
  const selectAction = (option: AgentStudioQuickActionOption): void => {
    if (sessionStartBlockedReason !== null) {
      return;
    }
    if (option.disabled) {
      return;
    }
    if (isGitConflictResolutionQuickAction(option)) {
      if (!onResolveGitConflictQuickAction) {
        throw new Error("Git conflict quick action handler is not configured.");
      }
      onResolveGitConflictQuickAction();
      onOpenChange(false);
      return;
    }
    onQuickAction(option);
    onOpenChange(false);
  };
  const selectMenuEntry = (entry: QuickActionMenuEntry): void => {
    if (entry.kind === "quick_action") {
      selectAction(entry.option);
      return;
    }

    if (sessionStartBlockedReason !== null || entry.option.disabled) {
      return;
    }
    onPrepareMessageFirstSession(entry.option);
    onOpenChange(false);
  };

  return (
    <div className="flex items-center gap-0">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-9 max-w-48 gap-2 rounded-r-none border-r-0 px-3"
        disabled={!canRunPrimaryAction}
        title={triggerTitle}
        aria-label={
          primaryAction ? `Run quick action: ${primaryAction.label}` : "Run primary quick action"
        }
        onClick={() => {
          if (primaryAction) {
            selectAction(primaryAction);
          }
        }}
      >
        <Zap className="size-4" />
        <span className="truncate">{primaryAction?.label ?? "Actions"}</span>
      </Button>
      <Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-9 rounded-l-none px-2"
            disabled={!canOpenActionsMenu}
            title="Open quick actions menu"
            aria-label="Open quick actions menu"
          >
            <ChevronDown className="size-3.5 opacity-80" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <Command>
            <CommandList>
              <CommandEmpty>No quick actions available.</CommandEmpty>
              {groupedMenuEntries.map((group) => (
                <CommandGroup key={group.role} heading={QUICK_ACTION_ROLE_LABELS[group.role]}>
                  {group.entries.map((entry) => (
                    <QuickActionCommandItem
                      key={quickActionEntryId(entry)}
                      entry={entry}
                      disabledReason={sessionStartBlockedReason}
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

export function AgentStudioHeader({ model }: { model: AgentStudioHeaderModel }): ReactElement {
  const {
    taskTitle,
    taskId,
    selectedRole,
    workflowSteps,
    onWorkflowStepSelect,
    sessionSelector,
    sessionCreateOptions,
    onPrepareMessageFirstSession,
    quickActions,
    primaryQuickAction,
    onQuickAction,
    onResolveGitConflictQuickAction,
    isCreatingSession,
    agentStudioReady,
  } = model;

  const [isQuickActionsMenuOpen, setIsQuickActionsMenuOpen] = useState(false);
  const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(false);
  const sessionHistoryTriggerRef = useRef<HTMLButtonElement | null>(null);
  const preventSessionTriggerRefocusRef = useRef(false);
  const restoreSessionTriggerFocusRef = useRef(false);

  const normalizedTaskTitle = taskTitle?.trim() ?? "";
  const hasTaskTitle = normalizedTaskTitle.length > 0;
  const normalizedTaskId = taskId?.trim() ?? "";
  const hasTaskId = normalizedTaskId.length > 0;
  const canOpenTaskDetails = hasTaskId && Boolean(model.onOpenTaskDetails);
  const sessionGroupsWithOptions = useMemo(
    () => sessionSelector.groups.filter((group) => group.options.length > 0),
    [sessionSelector.groups],
  );
  const sessionSelectorOptions = useMemo(
    () => sessionGroupsWithOptions.flatMap((group) => group.options),
    [sessionGroupsWithOptions],
  );
  const selectedSessionOption = useMemo(
    () => sessionSelectorOptions.find((option) => option.value === sessionSelector.value) ?? null,
    [sessionSelector.value, sessionSelectorOptions],
  );
  return (
    <CardHeader className="border-b border-border bg-card pb-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <CardTitle
              className="truncate text-xl"
              title={hasTaskTitle ? normalizedTaskTitle : undefined}
            >
              {hasTaskTitle ? normalizedTaskTitle : "Agent Studio"}
            </CardTitle>
          </div>
          {hasTaskId ? (
            <div className="mt-1 flex items-center gap-1.5">
              <TaskIdBadge taskId={normalizedTaskId} />
              {canOpenTaskDetails ? (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-auto shrink-0 gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground transition hover:border-border hover:bg-muted hover:text-muted-foreground"
                  title="Open task details"
                  aria-label="Open task details"
                  onClick={() => model.onOpenTaskDetails?.()}
                >
                  <ArrowUpRightFromSquare className="size-3" />
                  Open
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-stretch gap-2">
          <Popover open={isSessionMenuOpen} onOpenChange={setIsSessionMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                ref={sessionHistoryTriggerRef}
                type="button"
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-md"
                disabled={sessionSelector.disabled || !agentStudioReady}
                title={
                  selectedSessionOption
                    ? `Session history · ${selectedSessionOption.label}`
                    : "Session history"
                }
                aria-label={
                  selectedSessionOption
                    ? `Session history, selected ${selectedSessionOption.label}`
                    : "Session history"
                }
              >
                <History className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-80 p-0"
              onCloseAutoFocus={(event) => {
                if (!preventSessionTriggerRefocusRef.current) {
                  if (!restoreSessionTriggerFocusRef.current) {
                    return;
                  }

                  restoreSessionTriggerFocusRef.current = false;
                  event.preventDefault();
                  const requestAnimationFrameFn = globalThis.requestAnimationFrame;
                  if (typeof requestAnimationFrameFn === "function") {
                    requestAnimationFrameFn(() => {
                      sessionHistoryTriggerRef.current?.focus();
                    });
                    return;
                  }

                  sessionHistoryTriggerRef.current?.focus();
                  return;
                }

                preventSessionTriggerRefocusRef.current = false;
                event.preventDefault();
              }}
            >
              <Command>
                <CommandInput placeholder="Search sessions…" className="h-8 text-sm" />
                <CommandList>
                  <CommandEmpty>No sessions available.</CommandEmpty>
                  {sessionGroupsWithOptions.map((group) => (
                    <CommandGroup key={group.label} heading={group.label}>
                      {group.options.map((option) => (
                        <CommandItem
                          key={option.value}
                          value={`${group.label} ${option.label} ${option.description ?? ""}`}
                          onSelect={() => {
                            const focusBehavior = deriveSessionHistorySelectionFocusBehavior({
                              currentValue: sessionSelector.value,
                              nextValue: option.value,
                              shouldAutofocusComposerForValue:
                                sessionSelector.shouldAutofocusComposerForValue,
                            });
                            preventSessionTriggerRefocusRef.current = focusBehavior === "composer";
                            restoreSessionTriggerFocusRef.current = focusBehavior === "trigger";
                            sessionSelector.onValueChange(option.value);
                            setIsSessionMenuOpen(false);
                          }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-foreground">
                              {option.label}
                            </p>
                            {option.description ? (
                              <p className="truncate text-[11px] text-muted-foreground">
                                {option.description}
                              </p>
                            ) : null}
                          </div>
                          {sessionSelector.value === option.value ? (
                            <Check className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                          ) : null}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  ))}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <QuickActionsMenu
            isOpen={isQuickActionsMenuOpen}
            onOpenChange={setIsQuickActionsMenuOpen}
            agentStudioReady={agentStudioReady}
            isCreatingSession={isCreatingSession}
            options={quickActions}
            primaryAction={primaryQuickAction}
            sessionCreateOptions={sessionCreateOptions}
            onQuickAction={onQuickAction}
            onPrepareMessageFirstSession={onPrepareMessageFirstSession}
            onResolveGitConflictQuickAction={onResolveGitConflictQuickAction}
          />
        </div>
      </div>

      <div className="flex items-center justify-center py-0.5">
        <div className="flex items-center gap-1">
          {workflowSteps.map((entry, index) => {
            const Icon = entry.icon;
            const isSelected = selectedRole === entry.role;
            const shouldSpinInProgress = entry.state.liveSession === "running";
            const attentionVariant = getWorkflowStepAttentionVariant(entry);
            const nextStep = workflowSteps[index + 1] ?? null;
            return (
              <div key={entry.role} className="flex min-w-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className={cn(
                    "h-10 shrink-0 gap-2 rounded-lg border px-4 text-sm transition-colors",
                    workflowStepClassName(entry.state),
                    workflowBorderStyleClassName(entry.state),
                    workflowSelectionClassName(isSelected, entry.state),
                    "cursor-pointer",
                  )}
                  disabled={!agentStudioReady}
                  title={workflowStepHint(entry)}
                  onClick={() => {
                    onWorkflowStepSelect(entry.role, entry.externalSessionId);
                  }}
                >
                  <Icon className="size-4" />
                  {entry.label}
                  {entry.state.tone === "done" ? (
                    <Check className="size-3.5 text-success-accent" />
                  ) : null}
                  {attentionVariant === "session_waiting_input" ? (
                    <CircleDashed className="size-3.5" />
                  ) : null}
                  {entry.state.tone === "in_progress" && shouldSpinInProgress ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : null}
                  {entry.state.tone === "in_progress" && !shouldSpinInProgress ? (
                    <CircleDotDashed className="size-3.5" />
                  ) : null}
                  {entry.state.tone === "available" ? <Circle className="size-3" /> : null}
                  {entry.state.tone === "optional" ? <CircleDashed className="size-3" /> : null}
                  {attentionVariant === "blocked_task" ? (
                    <AlertTriangle className="size-3.5" />
                  ) : null}
                  {entry.state.tone === "rejected" || entry.state.tone === "failed" ? (
                    <AlertTriangle className="size-3.5" />
                  ) : null}
                </Button>
                {nextStep ? (
                  <ChevronRight
                    className={cn("size-4 shrink-0", workflowConnectorClassName(nextStep.state))}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </CardHeader>
  );
}
