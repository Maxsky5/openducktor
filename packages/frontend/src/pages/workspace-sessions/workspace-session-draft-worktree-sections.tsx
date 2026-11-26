import type { WorkspaceSessionWorktreeInput } from "@openducktor/contracts";
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  GitBranch as GitBranchIcon,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { type KeyboardEvent, type ReactElement, useMemo, useState } from "react";
import { toBranchSelectorOptions } from "@openducktor/frontend-core/lib/branch-selector-model";
import type { WorkspaceSessionDraftOptionsModel } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import { hasActiveNewWorktreeError } from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-draft-validation";
import {
  changeWorktreeMode,
  INITIAL_WORKSPACE_SESSION_WORKTREE,
  newWorktreeBranchState,
  selectExistingBranch,
  WORKTREE_NAME_MAX_LENGTH,
  worktreeDirectoryName,
} from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";
import { COMPOSER_QUIET_CONTROL_CLASS_NAME } from "@/components/features/agents/agent-chat/agent-chat-composer-surface";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

const WORKTREE_INPUT_CLASS_NAME =
  "h-8 font-mono text-xs placeholder:font-sans placeholder:text-muted-foreground/70";

function WorktreeFieldHint({
  error,
  previewLabel,
  previewValue,
  emptyHint,
}: {
  error: string | null;
  previewLabel?: string;
  previewValue?: string | null;
  emptyHint?: string | undefined;
}): ReactElement | null {
  if (error) {
    return (
      <p role="alert" className="break-words text-[11px] text-destructive">
        {error}
      </p>
    );
  }
  if (previewValue && previewLabel) {
    return (
      <p className="break-all text-[11px] text-muted-foreground">
        {previewLabel} <span className="font-mono text-foreground">{previewValue}</span>
      </p>
    );
  }
  if (!emptyHint) return null;
  return <p className="text-[11px] text-muted-foreground">{emptyHint}</p>;
}

function worktreeTriggerToneClass({
  hasError,
  needsSelection,
  quiet,
  needsSelectionClass,
  quietClass,
}: {
  hasError: boolean;
  needsSelection: boolean;
  quiet: boolean;
  needsSelectionClass?: string;
  quietClass?: string;
}): string {
  if (hasError) return "bg-destructive-surface/70 text-destructive hover:bg-destructive-surface";
  if (needsSelection) return cn("bg-muted/60 text-foreground hover:bg-muted", needsSelectionClass);
  if (quiet) return cn("hover:bg-muted/70", COMPOSER_QUIET_CONTROL_CLASS_NAME, quietClass);
  return "text-foreground hover:bg-muted/70";
}

function existingWorktreePlaceholder(isPending: boolean, isEmpty: boolean): string {
  if (isPending) return "Loading worktrees…";
  if (isEmpty) return "No other worktrees";
  return "Select worktree…";
}

function ResetWorktreeButton({
  disabled,
  onReset,
}: {
  disabled: boolean;
  onReset: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onReset}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      <RotateCcw className="size-3" aria-hidden="true" />
      Reset
    </button>
  );
}

function DraftWorktreeFolderInput({
  value,
  disabled,
  error,
  directoryName,
  labelClassName,
  emptyHint,
  onChange,
  onSubmitKey,
}: {
  value: string;
  disabled: boolean;
  error: string | null;
  directoryName: string | null;
  labelClassName: string;
  emptyHint?: string | undefined;
  onChange: (name: string) => void;
  onSubmitKey: (event: KeyboardEvent<HTMLInputElement>) => void;
}): ReactElement {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="draft-worktree-name" className={labelClassName}>
        Folder name
      </Label>
      <Input
        id="draft-worktree-name"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onSubmitKey}
        placeholder="my-branch"
        autoComplete="off"
        maxLength={WORKTREE_NAME_MAX_LENGTH}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        className={WORKTREE_INPUT_CLASS_NAME}
      />
      <WorktreeFieldHint
        error={error}
        previewLabel="Directory"
        previewValue={directoryName}
        emptyHint={emptyHint}
      />
    </div>
  );
}

function DraftNewBranchWorktreeInputs({
  optionsModel,
  disabled,
  onSubmitKey,
}: {
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
  onSubmitKey: (event: KeyboardEvent<HTMLInputElement>) => void;
}): ReactElement {
  const {
    options: { worktree },
    branchPrefix,
    fieldErrors,
    onChangeWorktree,
  } = optionsModel;
  const [folderOpen, setFolderOpen] = useState(() => worktree.name.trim().length > 0);
  const directoryName = worktreeDirectoryName(worktree.name);
  const { defaultBranch } = newWorktreeBranchState(worktree, branchPrefix);
  const explicitBranch = worktree.branchName?.trim() ?? "";
  const resolvedBranch = explicitBranch || defaultBranch;
  const branchPlaceholder = defaultBranch || `${branchPrefix?.trim() || "feat"}/my-branch`;
  const hasCustomFolder = worktree.name.trim().length > 0;
  const isCustomized = hasCustomFolder || explicitBranch.length > 0;
  const worktreeNameErr = fieldErrors.worktreeName;
  const branchErrorText = fieldErrors.worktreeBranch;
  const showFolderField = folderOpen || hasCustomFolder || Boolean(worktreeNameErr);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="draft-branch-name" className="text-xs font-medium text-foreground">
            Branch name
          </Label>
          {isCustomized ? (
            <ResetWorktreeButton
              disabled={disabled}
              onReset={() => {
                setFolderOpen(false);
                onChangeWorktree(INITIAL_WORKSPACE_SESSION_WORKTREE);
              }}
            />
          ) : null}
        </div>
        <Input
          id="draft-branch-name"
          value={worktree.branchName ?? ""}
          onChange={(event) =>
            onChangeWorktree({
              mode: "from_name",
              name: worktree.name,
              branchName: event.target.value || null,
            })
          }
          onKeyDown={onSubmitKey}
          placeholder={branchPlaceholder}
          autoComplete="off"
          disabled={disabled}
          aria-invalid={Boolean(branchErrorText)}
          className={WORKTREE_INPUT_CLASS_NAME}
        />
        <WorktreeFieldHint
          error={branchErrorText}
          previewLabel="Creates branch"
          previewValue={resolvedBranch || null}
          emptyHint="Leave empty to name from your first message."
        />
      </div>

      <Collapsible open={showFolderField} onOpenChange={setFolderOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="group inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <ChevronRight
              className="size-3 transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none"
              aria-hidden="true"
            />
            <span>Custom folder name</span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <DraftWorktreeFolderInput
            value={worktree.name}
            disabled={disabled}
            error={worktreeNameErr}
            directoryName={directoryName}
            labelClassName="sr-only"
            emptyHint="Optional folder name for this worktree."
            onChange={(name) => onChangeWorktree({ ...worktree, name })}
            onSubmitKey={onSubmitKey}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

function DraftExistingBranchWorktreeInputs({
  optionsModel,
  disabled,
  onSubmitKey,
}: {
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
  onSubmitKey: (event: KeyboardEvent<HTMLInputElement>) => void;
}): ReactElement {
  const {
    options: { worktree },
    branches,
    localBranchChoices,
    fieldErrors,
    onChangeWorktree,
  } = optionsModel;
  const existingBranchOptions = useMemo(() => {
    const choices = localBranchChoices ?? [];
    return toBranchSelectorOptions(choices.map((choice) => choice.branch)).map((option, index) => {
      const unavailableReason = choices[index]?.unavailableReason ?? null;
      return unavailableReason
        ? { ...option, disabled: true, description: unavailableReason }
        : option;
    });
  }, [localBranchChoices]);
  const directoryName = worktreeDirectoryName(worktree.name);
  const hasSelectedBranch = (worktree.branchName?.trim().length ?? 0) > 0;
  const worktreeNameErr = worktree.name.length > 0 ? fieldErrors.worktreeName : null;
  const existingBranchFailure = hasSelectedBranch ? fieldErrors.worktreeBranch : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label id="draft-existing-branch-label" className="text-xs font-medium text-foreground">
            Local branch
          </Label>
          <ResetWorktreeButton
            disabled={disabled}
            onReset={() => onChangeWorktree(INITIAL_WORKSPACE_SESSION_WORKTREE)}
          />
        </div>
        <Combobox
          triggerAriaLabelledBy="draft-existing-branch-label"
          value={worktree.branchName ?? ""}
          options={existingBranchOptions}
          placeholder={branches.isPending ? "Loading branches…" : "Select a local branch…"}
          searchPlaceholder="Filter local branches…"
          emptyText="No local branch found."
          className="w-72"
          triggerClassName="h-8 text-xs"
          disabled={disabled || branches.isPending || branches.isError}
          onValueChange={(branchName) =>
            onChangeWorktree(selectExistingBranch(worktree, branchName))
          }
        />
        <WorktreeFieldHint
          error={existingBranchFailure}
          emptyHint="Checks out this branch in a dedicated worktree."
        />
      </div>

      <DraftWorktreeFolderInput
        value={worktree.name}
        disabled={disabled}
        error={worktreeNameErr}
        directoryName={directoryName}
        labelClassName="text-xs font-medium text-foreground"
        onChange={(name) => onChangeWorktree({ ...worktree, name })}
        onSubmitKey={onSubmitKey}
      />
    </div>
  );
}

const describeNewWorktreeSummary = (
  worktree: WorkspaceSessionWorktreeInput,
  branchPrefix: string | undefined,
) => {
  if (worktree.mode === "from_branch") {
    const branch = worktree.branchName.trim();
    if (!branch) {
      return { label: "Select branch…", isAuto: false, needsSelection: true };
    }
    return { label: branch, isAuto: false, needsSelection: false };
  }
  const branch = worktree.branchName?.trim() ?? "";
  if (branch) {
    return { label: branch, isAuto: false, needsSelection: false };
  }
  const { defaultBranch } = newWorktreeBranchState(worktree, branchPrefix);
  if (defaultBranch) {
    return { label: defaultBranch, isAuto: false, needsSelection: false };
  }
  const folder = worktreeDirectoryName(worktree.name) ?? worktree.name.trim();
  if (folder) {
    return { label: folder, isAuto: false, needsSelection: false };
  }
  return { label: "Auto branch", isAuto: true, needsSelection: false };
};

export function DraftNewWorktreePopover({
  optionsModel,
  disabled,
}: {
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const {
    options: { worktree },
    branchPrefix,
    fieldErrors,
    onChangeWorktree,
  } = optionsModel;
  const summary = describeNewWorktreeSummary(worktree, branchPrefix);
  const activeError = hasActiveNewWorktreeError(worktree, fieldErrors);
  const handleSubmitKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter" && !activeError) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Worktree options: ${summary.label}`}
          className={cn(
            "inline-flex h-8 max-w-[15rem] min-w-0 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
            worktreeTriggerToneClass({
              hasError: Boolean(activeError),
              needsSelection: summary.needsSelection,
              quiet: summary.isAuto,
            }),
          )}
        >
          {summary.isAuto ? (
            <Sparkles className="size-3.5 shrink-0 opacity-75" aria-hidden="true" />
          ) : (
            <GitBranchIcon className="size-3.5 shrink-0 opacity-75" aria-hidden="true" />
          )}
          <span className="truncate">{summary.label}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-80 p-3.5">
        <div className="flex flex-col gap-3">
          <Tabs
            value={worktree.mode}
            onValueChange={(mode) => {
              if (mode === "from_branch" || mode === "from_name") {
                onChangeWorktree(changeWorktreeMode(worktree, mode));
              }
            }}
          >
            <TabsList
              aria-label="Worktree creation mode"
              className="grid h-8 w-full grid-cols-2 rounded-lg bg-muted/70 p-0.5"
            >
              <TabsTrigger value="from_name" disabled={disabled} className="rounded-md text-xs">
                New branch
              </TabsTrigger>
              <TabsTrigger value="from_branch" disabled={disabled} className="rounded-md text-xs">
                Existing branch
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {worktree.mode === "from_name" ? (
            <DraftNewBranchWorktreeInputs
              optionsModel={optionsModel}
              disabled={disabled}
              onSubmitKey={handleSubmitKey}
            />
          ) : (
            <DraftExistingBranchWorktreeInputs
              optionsModel={optionsModel}
              disabled={disabled}
              onSubmitKey={handleSubmitKey}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function DraftExistingWorktreePicker({
  optionsModel,
  disabled,
}: {
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
}): ReactElement {
  const {
    options: { existingWorktreeDirectory: selectedDirectory },
    worktrees,
    existingWorktreeChoices,
    fieldErrors,
    onSelectExistingWorktree,
  } = optionsModel;

  const existingWorktreeOptions = useMemo<ComboboxOption[]>(
    () =>
      existingWorktreeChoices.map((choice) => {
        const option: ComboboxOption = {
          value: choice.value,
          label: choice.label,
          description: choice.description,
          icon: <FolderGit2 className="size-3.5" aria-hidden="true" />,
        };
        if (choice.disabled) {
          option.disabled = true;
        } else {
          option.searchKeywords = [choice.value, choice.branchName ?? ""];
        }
        return option;
      }),
    [existingWorktreeChoices],
  );

  const isEmpty = worktrees.isSuccess && (worktrees.data?.worktrees.length ?? 0) === 0;
  const hasInvalidSelection = Boolean(selectedDirectory && fieldErrors.existingWorktree);
  const needsSelection =
    !selectedDirectory && !isEmpty && !worktrees.isPending && !worktrees.isError;
  const placeholder = existingWorktreePlaceholder(worktrees.isPending, isEmpty);

  return (
    <div className="flex min-w-0 items-center">
      <Label id="draft-existing-worktree-label" className="sr-only">
        Existing worktree
      </Label>
      <Combobox
        triggerAriaLabelledBy="draft-existing-worktree-label"
        value={selectedDirectory ?? ""}
        options={existingWorktreeOptions}
        placeholder={placeholder}
        searchPlaceholder="Search worktrees…"
        emptyText="No worktree found."
        className="w-80"
        triggerClassName={cn(
          "h-8 w-auto max-w-[16rem] rounded-lg border-transparent px-2 text-xs font-medium",
          worktreeTriggerToneClass({
            hasError: hasInvalidSelection,
            needsSelection,
            quiet: true,
            needsSelectionClass: "px-2.5",
            quietClass: "bg-transparent",
          }),
        )}
        disabled={disabled || !worktrees.isSuccess || isEmpty}
        onValueChange={onSelectExistingWorktree}
      />
    </div>
  );
}
