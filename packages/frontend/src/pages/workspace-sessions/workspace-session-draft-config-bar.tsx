import type { WorkspaceSessionLocation } from "@openducktor/contracts";
import { Bot, Folder, FolderGit2, GitBranch as GitBranchIcon, Settings2 } from "lucide-react";
import { type ReactElement, use, useMemo, useState } from "react";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  targetBranchFromSelection,
  targetBranchSelectionValue,
} from "@openducktor/frontend-core/lib/target-branch";
import {
  NO_CUSTOM_AGENT_ROLE,
  type WorkspaceSessionDraftOptionsModel,
} from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import { hasActiveNewWorktreeError } from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-draft-validation";
import { COMPOSER_QUIET_CONTROL_CLASS_NAME } from "@/components/features/agents/agent-chat/agent-chat-composer-surface";
import { BranchSelector } from "@/components/features/repository/branch-selector";
import { SettingsModalContext } from "@/components/features/settings/settings-modal-context";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  DraftExistingWorktreePicker,
  DraftNewWorktreePopover,
} from "./workspace-session-draft-worktree-sections";

const LOCATION_OPTIONS: ComboboxOption[] = [
  {
    value: "local_repo_root",
    label: "Current checkout",
    description: "Work directly in the repository",
    icon: <Folder className="size-3.5" aria-hidden="true" />,
  },
  {
    value: "local_worktree",
    label: "New worktree",
    description: "Create an isolated branch worktree",
    icon: <GitBranchIcon className="size-3.5" aria-hidden="true" />,
  },
  {
    value: "existing_worktree",
    label: "Existing worktree",
    description: "Reuse another registered worktree",
    icon: <FolderGit2 className="size-3.5" aria-hidden="true" />,
  },
];

const FALLBACK_ROLE_OPTIONS: ComboboxOption[] = [{ value: NO_CUSTOM_AGENT_ROLE, label: "No role" }];

const isWorkspaceSessionLocation = (value: string): value is WorkspaceSessionLocation =>
  value === "local_repo_root" || value === "local_worktree" || value === "existing_worktree";

type DraftConfigurationBarProps = {
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
};

function DraftInlineError({ message }: { message: string | null }): ReactElement | null {
  if (!message) return null;
  return (
    <p role="alert" className="text-[11px] text-destructive">
      {message}
    </p>
  );
}

function DraftInlineRetryAlert({
  message,
  retryLabel,
  disabled,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  disabled: boolean;
  onRetry: () => void;
}): ReactElement {
  return (
    <div role="alert" className="flex items-center gap-2 text-[11px] text-destructive">
      <span className="flex-1">{message}</span>
      <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

function DraftWorktreeFeedback({
  optionsModel,
  disabled,
}: DraftConfigurationBarProps): ReactElement | null {
  const { options, worktrees, fieldErrors, onSelectLocation } = optionsModel;
  if (options.location === "local_worktree") {
    return <DraftInlineError message={hasActiveNewWorktreeError(options.worktree, fieldErrors)} />;
  }
  if (options.location !== "existing_worktree") return null;
  if (worktrees.isError) {
    return (
      <DraftInlineRetryAlert
        message={`Could not load worktrees: ${errorMessage(worktrees.error)}`}
        retryLabel="Retry worktrees"
        disabled={disabled || worktrees.isFetching}
        onRetry={() => void worktrees.refetch()}
      />
    );
  }
  if (worktrees.isSuccess && worktrees.data.worktrees.length === 0) {
    return (
      <p
        role="status"
        className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground"
      >
        <span>No other worktrees exist for this repository.</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelectLocation("local_worktree")}
          className="font-medium text-foreground underline underline-offset-2 transition-colors hover:text-primary disabled:pointer-events-none disabled:opacity-50"
        >
          Switch to New worktree
        </button>
      </p>
    );
  }
  if (options.existingWorktreeDirectory !== null) {
    return <DraftInlineError message={fieldErrors.existingWorktree} />;
  }
  return null;
}

function DraftConfigurationFeedback({
  optionsModel,
  disabled,
}: DraftConfigurationBarProps): ReactElement {
  const { roles, branches, fieldErrors } = optionsModel;
  return (
    <div className="flex flex-col gap-1.5 px-1 empty:hidden">
      <DraftWorktreeFeedback optionsModel={optionsModel} disabled={disabled} />
      <DraftInlineError message={fieldErrors.targetBranch} />
      {fieldErrors.role && roles.isError ? (
        <DraftInlineRetryAlert
          message={fieldErrors.role}
          retryLabel="Retry roles"
          disabled={disabled}
          onRetry={() => void roles.refetch()}
        />
      ) : (
        <DraftInlineError message={fieldErrors.role} />
      )}
      {branches.isError ? (
        <DraftInlineRetryAlert
          message={`Could not load branches: ${errorMessage(branches.error)}`}
          retryLabel="Retry branches"
          disabled={disabled}
          onRetry={() => void branches.refetch()}
        />
      ) : null}
      <DraftInlineError message={fieldErrors.runtime} />
    </div>
  );
}

function DraftRolePicker({ optionsModel, disabled }: DraftConfigurationBarProps): ReactElement {
  const [open, setOpen] = useState(false);
  const settingsModal = use(SettingsModalContext);
  const { options, roles, roleChoices, onSelectRole } = optionsModel;
  const roleOptions = useMemo<ComboboxOption[]>(
    () => roleChoices ?? FALLBACK_ROLE_OPTIONS,
    [roleChoices],
  );

  return (
    <div className="flex min-w-0 items-center">
      <Label id="draft-custom-role-label" className="sr-only">
        Custom role
      </Label>
      <div className="relative max-w-[11rem]">
        <Bot
          className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Combobox
          open={open}
          onOpenChange={setOpen}
          triggerAriaLabelledBy="draft-custom-role-label"
          value={options.customAgentRoleId ?? NO_CUSTOM_AGENT_ROLE}
          options={roleOptions}
          disabled={disabled || roles.isPending || roles.isError}
          className="w-56"
          triggerClassName={cn(
            "h-8 w-full rounded-lg border-transparent bg-transparent pl-7 pr-2 text-xs font-medium hover:bg-muted/70",
            COMPOSER_QUIET_CONTROL_CLASS_NAME,
          )}
          onValueChange={onSelectRole}
          footer={
            settingsModal ? (
              <div className="border-t border-border p-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    settingsModal.openSettings({ deepLink: { kind: "custom-agent-roles" } });
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  <Settings2 className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>Manage roles…</span>
                </button>
              </div>
            ) : null
          }
        />
      </div>
    </div>
  );
}

export function DraftConfigurationBar({
  optionsModel,
  disabled,
}: DraftConfigurationBarProps): ReactElement {
  const {
    options,
    branches,
    effectiveTargetBranch,
    targetBranchChoices,
    onSelectLocation,
    onSelectTargetBranch,
  } = optionsModel;

  return (
    <section aria-label="Session options" className="flex flex-col gap-2 text-xs">
      <div className="flex h-8 flex-nowrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <div className="flex shrink-0 items-center">
            <Label id="draft-work-location-label" className="sr-only">
              Work location
            </Label>
            <Combobox
              triggerAriaLabelledBy="draft-work-location-label"
              value={options.location}
              options={LOCATION_OPTIONS}
              searchable={false}
              disabled={disabled}
              className="w-72"
              triggerClassName={cn(
                "h-8 w-auto rounded-lg border-transparent bg-transparent px-2 text-xs font-medium hover:bg-muted/70",
                COMPOSER_QUIET_CONTROL_CLASS_NAME,
              )}
              onValueChange={(next) => {
                if (isWorkspaceSessionLocation(next)) {
                  onSelectLocation(next);
                }
              }}
            />
          </div>

          {options.location === "local_worktree" ? (
            <>
              <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border/70" aria-hidden="true" />
              <DraftNewWorktreePopover optionsModel={optionsModel} disabled={disabled} />
            </>
          ) : null}

          {options.location === "existing_worktree" ? (
            <>
              <span className="mx-0.5 h-3.5 w-px shrink-0 bg-border/70" aria-hidden="true" />
              <DraftExistingWorktreePicker optionsModel={optionsModel} disabled={disabled} />
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <div className="flex min-w-0 items-center">
            <Label id="draft-target-branch-label" className="sr-only">
              Target branch
            </Label>
            <div className="max-w-[13rem]">
              <BranchSelector
                triggerAriaLabelledBy="draft-target-branch-label"
                value={
                  effectiveTargetBranch ? targetBranchSelectionValue(effectiveTargetBranch) : ""
                }
                options={targetBranchChoices ?? []}
                placeholder={branches.isPending ? "Loading…" : "Target branch"}
                disabled={disabled}
                popoverClassName="w-64"
                triggerClassName={cn(
                  "h-8 rounded-lg border-transparent bg-transparent pl-7 pr-2 text-xs font-medium hover:bg-muted/70",
                  COMPOSER_QUIET_CONTROL_CLASS_NAME,
                )}
                onValueChange={(selection) =>
                  onSelectTargetBranch(targetBranchFromSelection(selection))
                }
              />
            </div>
          </div>

          <DraftRolePicker optionsModel={optionsModel} disabled={disabled} />
        </div>
      </div>

      <DraftConfigurationFeedback optionsModel={optionsModel} disabled={disabled} />
    </section>
  );
}
