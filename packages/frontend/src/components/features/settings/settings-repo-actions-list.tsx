import type { RepoAction, RepoActions } from "@openducktor/contracts";
import { ChevronDown, ChevronUp, Pencil, Plus, Trash2 } from "lucide-react";
import { type ReactElement, useState } from "react";
import { REPO_ACTION_ICONS } from "@/components/features/repository-actions/repo-action-icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDialogPresence } from "@/components/ui/dialog";
import {
  addRepoAction,
  createRepoAction,
  deleteRepoAction,
  moveRepoAction,
  type RepoActionFields,
  setDefaultRepoAction,
  updateRepoAction,
} from "./repo-actions-draft";
import { RepoActionDialog } from "./settings-repo-action-dialog";

type UpdateRepoActions = (updater: (current: RepoActions) => RepoActions) => void;

type Props = {
  actions: RepoActions;
  isDisabled: boolean;
  onUpdateActions: UpdateRepoActions;
};

type ActionEditor = {
  /** A new key for each open gives the dialog a new form state. */
  key: number;
  open: boolean;
  action: RepoAction | null;
};

export function RepoActionsList({ actions, isDisabled, onUpdateActions }: Props): ReactElement {
  const [editor, setEditor] = useState<ActionEditor | null>(null);
  const isEditorMounted = useDialogPresence(editor?.open ?? false);
  const hasActions = actions.items.length > 0;

  const openEditor = (action: RepoAction | null): void => {
    setEditor((current) => ({ key: (current?.key ?? 0) + 1, open: true, action }));
  };

  const closeEditor = (): void => {
    setEditor((current) => (current ? { ...current, open: false } : current));
  };

  const saveEditor = (fields: RepoActionFields): void => {
    const editedAction = editor?.action ?? null;
    if (editedAction) {
      onUpdateActions((current) => updateRepoAction(current, editedAction.id, fields));
    } else {
      const action = createRepoAction(fields);
      onUpdateActions((current) => addRepoAction(current, action));
    }
    closeEditor();
  };

  const addButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={isDisabled}
      onClick={() => openEditor(null)}
    >
      <Plus className="size-4" />
      Add action
    </Button>
  );

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-1">
          <h3 className="text-sm font-medium text-foreground">Actions</h3>
          <p className="text-xs text-muted-foreground">
            Actions are repository commands that you run from the session top bar. Each run opens a
            new terminal. The list order is the menu order and the run order on worktree creation.
          </p>
        </div>
        {hasActions ? addButton : null}
      </div>

      {hasActions ? (
        <ul
          aria-label="Actions"
          className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card"
        >
          {actions.items.map((action, index) => (
            <RepoActionRow
              key={action.id}
              action={action}
              isDefault={action.id === actions.defaultActionId}
              isFirst={index === 0}
              isLast={index === actions.items.length - 1}
              isDisabled={isDisabled}
              onEdit={() => openEditor(action)}
              onUpdateActions={onUpdateActions}
            />
          ))}
        </ul>
      ) : (
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border bg-muted/40 p-3">
          <p className="text-sm text-muted-foreground">No actions yet.</p>
          {addButton}
        </div>
      )}

      {editor && isEditorMounted ? (
        <RepoActionDialog
          key={editor.key}
          open={editor.open}
          action={editor.action}
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
          onSave={saveEditor}
        />
      ) : null}
    </div>
  );
}

function RepoActionRow({
  action,
  isDefault,
  isFirst,
  isLast,
  isDisabled,
  onEdit,
  onUpdateActions,
}: {
  action: RepoAction;
  isDefault: boolean;
  isFirst: boolean;
  isLast: boolean;
  isDisabled: boolean;
  onEdit: () => void;
  onUpdateActions: UpdateRepoActions;
}): ReactElement {
  const Icon = REPO_ACTION_ICONS[action.icon].icon;

  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>

      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium text-foreground">{action.name}</span>
          {isDefault ? <Badge variant="secondary">Default</Badge> : null}
          {action.runOnWorktreeCreate ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Runs on worktree creation
            </Badge>
          ) : null}
          {action.waitBeforeAgentStart ? (
            <Badge variant="outline" className="font-normal text-muted-foreground">
              Agent waits
            </Badge>
          ) : null}
        </div>
        <code className="truncate font-mono text-xs text-muted-foreground" title={action.command}>
          {firstCommandLine(action.command)}
        </code>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {isDefault ? null : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            disabled={isDisabled}
            aria-label={`Set ${action.name} as default`}
            onClick={() => onUpdateActions((current) => setDefaultRepoAction(current, action.id))}
          >
            Set as default
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={isDisabled || isFirst}
          aria-label={`Move ${action.name} up`}
          title="Move up"
          onClick={() => onUpdateActions((current) => moveRepoAction(current, action.id, "up"))}
        >
          <ChevronUp className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={isDisabled || isLast}
          aria-label={`Move ${action.name} down`}
          title="Move down"
          onClick={() => onUpdateActions((current) => moveRepoAction(current, action.id, "down"))}
        >
          <ChevronDown className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          disabled={isDisabled}
          aria-label={`Edit ${action.name}`}
          title="Edit action"
          onClick={onEdit}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          type="button"
          variant="destructiveGhost"
          size="icon"
          className="size-8"
          disabled={isDisabled}
          aria-label={`Delete ${action.name}`}
          title="Delete action"
          onClick={() => onUpdateActions((current) => deleteRepoAction(current, action.id))}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </li>
  );
}

function firstCommandLine(command: string): string {
  const newlineIndex = command.indexOf("\n");
  return newlineIndex === -1 ? command : command.slice(0, newlineIndex);
}
