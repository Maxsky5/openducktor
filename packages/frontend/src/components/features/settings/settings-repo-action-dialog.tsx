import { REPO_ACTION_ICON_VALUES, type RepoAction } from "@openducktor/contracts";
import { type FormEvent, type ReactElement, useId, useState } from "react";
import { REPO_ACTION_ICONS } from "@/components/features/repository-actions/repo-action-icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  NEW_REPO_ACTION_FIELDS,
  type RepoActionFields,
  validateRepoActionFields,
} from "./repo-actions-draft";

type RepoActionDialogProps = {
  open: boolean;
  /** The action to edit. `null` adds a new action. */
  action: RepoAction | null;
  onOpenChange: (open: boolean) => void;
  onSave: (fields: RepoActionFields) => void;
};

export function RepoActionDialog({
  open,
  action,
  onOpenChange,
  onSave,
}: RepoActionDialogProps): ReactElement {
  const [fields, setFields] = useState<RepoActionFields>(() =>
    action ? toRepoActionFields(action) : NEW_REPO_ACTION_FIELDS,
  );
  const [hasAttemptedSave, setHasAttemptedSave] = useState(false);
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false);
  // The icon picker opens inside the dialog content so that the dialog focus trap includes it.
  const [contentElement, setContentElement] = useState<HTMLDivElement | null>(null);
  const fieldId = useId();
  const nameId = `${fieldId}-name`;
  const commandId = `${fieldId}-command`;
  const runOnWorktreeCreateId = `${fieldId}-run-on-worktree-create`;
  const waitBeforeAgentStartId = `${fieldId}-wait-before-agent-start`;
  const errors = hasAttemptedSave ? validateRepoActionFields(fields) : {};
  const selectedIcon = REPO_ACTION_ICONS[fields.icon];
  const SelectedIcon = selectedIcon.icon;

  const updateFields = (patch: Partial<RepoActionFields>): void => {
    setFields((current) => ({ ...current, ...patch }));
  };

  const save = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const fieldErrors = validateRepoActionFields(fields);
    if (fieldErrors.name || fieldErrors.command) {
      setHasAttemptedSave(true);
      return;
    }
    onSave({ ...fields, name: fields.name.trim(), command: fields.command.trim() });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent ref={setContentElement} className="p-0 sm:max-w-lg">
        <form onSubmit={save}>
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle>{action ? "Edit action" : "Add action"}</DialogTitle>
            <DialogDescription>
              Actions are repository commands that you run from the session top bar.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="grid gap-4 px-6 py-4">
            <div className="grid gap-2">
              <Label htmlFor={nameId}>Name</Label>
              <div className="flex items-center gap-2">
                <Popover open={isIconPickerOpen} onOpenChange={setIsIconPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      aria-label={`Icon: ${selectedIcon.label}`}
                      title="Choose icon"
                    >
                      <SelectedIcon className="size-4" aria-hidden="true" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    portalContainer={contentElement}
                    aria-label="Action icons"
                    className="w-auto p-2"
                  >
                    <div className="grid grid-cols-3 gap-1">
                      {REPO_ACTION_ICON_VALUES.map((icon) => {
                        const presentation = REPO_ACTION_ICONS[icon];
                        const Icon = presentation.icon;
                        const isSelected = icon === fields.icon;
                        return (
                          <Button
                            key={icon}
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={presentation.label}
                            aria-pressed={isSelected}
                            title={presentation.label}
                            className={cn(isSelected && "bg-accent text-accent-foreground")}
                            onClick={() => {
                              updateFields({ icon });
                              setIsIconPickerOpen(false);
                            }}
                          >
                            <Icon className="size-4" aria-hidden="true" />
                          </Button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
                <Input
                  id={nameId}
                  value={fields.name}
                  placeholder="Test"
                  className={INVALID_FIELD_CLASS_NAME}
                  aria-invalid={errors.name ? true : undefined}
                  aria-describedby={errors.name ? `${nameId}-error` : undefined}
                  onChange={(event) => updateFields({ name: event.currentTarget.value })}
                />
              </div>
              <FieldError id={`${nameId}-error`} message={errors.name} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor={commandId}>Command</Label>
              <Textarea
                id={commandId}
                rows={4}
                value={fields.command}
                placeholder="bun test"
                className={cn("font-mono", INVALID_FIELD_CLASS_NAME)}
                aria-invalid={errors.command ? true : undefined}
                aria-describedby={errors.command ? `${commandId}-error` : undefined}
                onChange={(event) => updateFields({ command: event.currentTarget.value })}
              />
              <p className="text-xs text-muted-foreground">
                Put each command on a separate line. The lines run in one shell, and a line runs
                only after the previous line succeeds. Lines that start with # are skipped.
              </p>
              <FieldError id={`${commandId}-error`} message={errors.command} />
            </div>

            <ActionSwitchRow
              id={runOnWorktreeCreateId}
              label="Run automatically on worktree creation"
              description="OpenDucktor runs this action when it creates a worktree."
              checked={fields.runOnWorktreeCreate}
              onCheckedChange={(checked) =>
                updateFields({
                  runOnWorktreeCreate: checked,
                  waitBeforeAgentStart: checked && fields.waitBeforeAgentStart,
                })
              }
            />
            <ActionSwitchRow
              id={waitBeforeAgentStartId}
              label="Wait for it to finish before the agent starts"
              description="The agent starts only after this action finishes. Turn on the worktree creation run first."
              checked={fields.waitBeforeAgentStart}
              disabled={!fields.runOnWorktreeCreate}
              onCheckedChange={(checked) => updateFields({ waitBeforeAgentStart: checked })}
            />
          </DialogBody>

          <DialogFooter className="mt-0 border-t border-border bg-muted/20 px-6 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save action</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  if (!message) {
    return null;
  }
  return (
    <p id={id} role="alert" className="text-xs text-destructive-muted">
      {message}
    </p>
  );
}

function ActionSwitchRow({
  id,
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3">
      <div className="grid gap-1">
        <Label htmlFor={id}>{label}</Label>
        <p id={`${id}-description`} className="text-xs text-muted-foreground">
          {description}
        </p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        aria-describedby={`${id}-description`}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

const INVALID_FIELD_CLASS_NAME = "aria-invalid:border-destructive-muted";

function toRepoActionFields({ id: _id, ...fields }: RepoAction): RepoActionFields {
  return fields;
}
