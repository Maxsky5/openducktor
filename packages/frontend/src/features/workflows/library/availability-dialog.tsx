import type { WorkflowAvailability, WorkflowLibraryEntry } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { Loader2, Save } from "lucide-react";
import { type ReactElement, useId, useState } from "react";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ToolbarSearchField } from "@/components/ui/search-field";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { OptionCard, OptionCardMark } from "@/components/ui/option-card";
import { RadioGroup } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useWorkspaceState } from "@/state";
import type { WorkspaceRecord } from "@openducktor/contracts";
import { useSetAvailability } from "../use-workflow-library-commands";
import { WORKFLOW_DIALOG } from "../workflow-dialog";
import { availableNowhere } from "./workflow-availability";

type Mode = WorkflowAvailability["mode"];
type ListMode = Exclude<Mode, "all">;

const MODES: readonly { value: Mode; label: string; hint: string }[] = [
  { value: "all", label: "All repositories", hint: "Also the repositories that you add later." },
  { value: "only", label: "Only these", hint: "Only the repositories that you check." },
  { value: "except", label: "All except these", hint: "Every repository but the ones you check." },
];

const sameIds = (left: readonly string[], right: readonly string[]) => {
  const rightIds = new Set(right);
  return left.length === right.length && left.every((id) => rightIds.has(id));
};

/** Whether the rule in the dialog differs from the saved rule. */
const changed = (saved: WorkflowAvailability, next: WorkflowAvailability) =>
  saved.mode !== next.mode ||
  (saved.mode !== "all" && next.mode !== "all" && !sameIds(saved.workspaceIds, next.workspaceIds));

/** A list longer than this gets a search field and a fixed height. */
const SEARCH_FROM = 6;

/**
 * The repositories of a list mode, each with its check. A long list has a search field and keeps
 * its height while the search filters it, so the dialog does not change size at each key.
 */
function RepositoryChecklist({
  id,
  title,
  workspaces,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  title: string;
  workspaces: readonly WorkspaceRecord[];
  checked: ReadonlySet<string>;
  disabled: boolean;
  /** Checks or unchecks the given repositories. */
  onToggle: (workspaceIds: readonly string[], on: boolean) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const long = workspaces.length > SEARCH_FROM;
  const term = query.trim().toLowerCase();
  const shown = term
    ? workspaces.filter(({ workspaceName }) => workspaceName.toLowerCase().includes(term))
    : workspaces;
  const selected = workspaces.filter(({ workspaceId }) => checked.has(workspaceId)).length;
  const shownIds = shown.map(({ workspaceId }) => workspaceId);
  const shownChecked = shownIds.filter((workspaceId) => checked.has(workspaceId)).length;
  const allShown = shownIds.length > 0 && shownChecked === shownIds.length;
  const someShown = shownChecked > 0 && !allShown;
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-2 flex w-full items-baseline justify-between gap-3 text-sm font-medium">
        {title}
        <span className="text-xs font-normal tabular-nums text-muted-foreground">
          {selected} of {workspaces.length} checked
        </span>
      </legend>
      <div className="flex flex-col overflow-hidden rounded-lg border border-border">
        <div className="flex min-h-11 items-center gap-3 border-b border-border py-1.5 pr-1.5 pl-3">
          <Checkbox
            aria-label={term ? "Select all shown" : "Select all"}
            disabled={shown.length === 0}
            checked={allShown ? true : someShown ? "indeterminate" : false}
            onCheckedChange={() => onToggle(shownIds, !allShown)}
          />
          {long ? (
            <div className="min-w-0 flex-1">
              <ToolbarSearchField
                id={`${id}-search`}
                label="Search repositories"
                placeholder="Search repositories"
                size="md"
                value={query}
                onValueChange={setQuery}
              />
            </div>
          ) : null}
        </div>
        <ul className={cn("flex flex-col overflow-y-auto p-1", long && "h-72")}>
          {shown.map((workspace) => {
            const checkboxId = `${id}-${workspace.workspaceId}`;
            return (
              <li key={workspace.workspaceId}>
                <label
                  htmlFor={checkboxId}
                  className="flex h-10 cursor-pointer items-center gap-3 rounded-md px-2 text-sm hover:bg-accent"
                >
                  <Checkbox
                    id={checkboxId}
                    checked={checked.has(workspace.workspaceId)}
                    onCheckedChange={(on) => onToggle([workspace.workspaceId], on === true)}
                  />
                  <WorkspaceTile workspace={workspace} size="xs" className="shadow-none" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {workspace.workspaceName}
                  </span>
                </label>
              </li>
            );
          })}
          {shown.length === 0 ? (
            <li className="px-2 py-3 text-sm text-muted-foreground">
              No repository matches “{query.trim()}”.
            </li>
          ) : null}
        </ul>
      </div>
    </fieldset>
  );
}

function AvailabilityForm({
  entry,
  isDefault,
  onClose,
}: {
  entry: WorkflowLibraryEntry;
  isDefault: boolean;
  onClose: () => void;
}): ReactElement {
  const id = useId();
  const { workspaces } = useWorkspaceState();
  const setAvailability = useSetAvailability();
  const saved = entry.availability;
  const [mode, setMode] = useState<Mode>(saved.mode);
  const savedIds = saved.mode === "all" ? [] : saved.workspaceIds;
  // A rule can list a closed repository. The list shows open repositories and keeps the others.
  const openIds = new Set(workspaces.map(({ workspaceId }) => workspaceId));
  const keptIds = savedIds.filter((workspaceId) => !openIds.has(workspaceId));
  // Each list has its own checks: a check means "can use it" in one and "cannot" in the other.
  const savedChecks = new Set(savedIds.filter((workspaceId) => openIds.has(workspaceId)));
  const [checks, setChecks] = useState<Record<ListMode, ReadonlySet<string>>>({
    only: saved.mode === "only" ? savedChecks : new Set(),
    except: saved.mode === "except" ? savedChecks : new Set(),
  });
  const listKept = (listMode: ListMode) => (saved.mode === listMode ? keptIds : []);
  const next: WorkflowAvailability =
    mode === "all" ? { mode } : { mode, workspaceIds: [...checks[mode], ...listKept(mode)] };
  const pending = setAvailability.isPending;
  const toggle = (listMode: ListMode, workspaceIds: readonly string[], on: boolean) =>
    setChecks((current) => {
      const updated = new Set(current[listMode]);
      for (const workspaceId of workspaceIds)
        if (on) updated.add(workspaceId);
        else updated.delete(workspaceId);
      return { ...current, [listMode]: updated };
    });
  return (
    <form
      className="flex min-h-0 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        setAvailability.mutate(
          { workflowId: entry.id, availability: next },
          { onSuccess: onClose },
        );
      }}
    >
      <DialogHeader className={WORKFLOW_DIALOG.header}>
        <DialogTitle>Availability of {entry.name}</DialogTitle>
        <DialogDescription>
          Choose the repositories where new tasks can use this workflow.
        </DialogDescription>
      </DialogHeader>
      <DialogBody className={cn(WORKFLOW_DIALOG.body, "flex flex-col gap-5")}>
        <RadioGroup
          aria-label="Repositories that can use it"
          value={mode}
          disabled={pending}
          className="grid gap-2 sm:grid-cols-3"
          onValueChange={(value) => {
            const option = MODES.find((candidate) => candidate.value === value);
            if (option) setMode(option.value);
          }}
        >
          {MODES.map((option) => (
            <OptionCard
              key={option.value}
              value={option.value}
              disabled={isDefault && option.value !== "all"}
              className="flex items-start gap-2.5 px-3 py-2.5 text-sm"
            >
              <OptionCardMark className="mt-0.5" />
              <span className="flex flex-col gap-0.5">
                <span className="font-medium">{option.label}</span>
                <span className="text-xs leading-5 text-muted-foreground">{option.hint}</span>
              </span>
            </OptionCard>
          ))}
        </RadioGroup>
        {isDefault ? (
          <p className="text-sm text-muted-foreground">
            New tasks use this workflow by default, so every repository can use it. Make another
            workflow the default to limit it.
          </p>
        ) : null}
        {mode === "all" ? null : (
          <RepositoryChecklist
            id={id}
            title={
              mode === "only" ? "Repositories that can use it" : "Repositories that cannot use it"
            }
            workspaces={workspaces}
            checked={checks[mode]}
            disabled={pending}
            onToggle={(workspaceIds, on) => toggle(mode, workspaceIds, on)}
          />
        )}
        {availableNowhere(next, workspaces) ? (
          <Alert variant="warning" role="note">
            <AlertDescription>
              No repository can use this workflow. New tasks cannot pick it.
            </AlertDescription>
          </Alert>
        ) : null}
        {setAvailability.error ? (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage(setAvailability.error)}</AlertDescription>
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter className={WORKFLOW_DIALOG.footer}>
        <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !changed(saved, next)}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Sets which repositories can use a workflow: all of them, only some, or all but some. */
export function AvailabilityDialog({
  entry,
  isDefault,
  onClose,
}: {
  /** The workflow to change. Null closes the dialog. */
  entry: WorkflowLibraryEntry | null;
  isDefault: boolean;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={WORKFLOW_DIALOG.lg}>
        {entry ? (
          <AvailabilityForm key={entry.id} entry={entry} isDefault={isDefault} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
