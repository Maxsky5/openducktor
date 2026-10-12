import type { CustomAgentRole } from "@openducktor/contracts";
import { useEffect, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  createCustomAgentRoleDraft,
  type CustomAgentRoleFieldErrors,
  type CustomAgentRoleValidationState,
} from "@/state/read-models/custom-agent-role-settings";
import {
  SettingsListEditor,
  SettingsListEditorCard,
  SettingsListEditorEmptyState,
} from "./settings-list-editor";

type Props = {
  roles: CustomAgentRole[];
  selectedRoleId: string | null;
  validation: CustomAgentRoleValidationState;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onUpdate: (updater: (current: CustomAgentRole[]) => CustomAgentRole[]) => void;
};

const roleLabel = (role: CustomAgentRole): string => role.name.trim() || "Untitled role";

export function SettingsCustomAgentRolesSection({
  roles,
  selectedRoleId,
  validation,
  disabled,
  onSelect,
  onUpdate,
}: Props) {
  const selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0] ?? null;
  const autofocusId = useRef<string | null>(null);
  const [deleteRoleId, setDeleteRoleId] = useState<string | null>(null);
  const roleToDelete = roles.find((role) => role.id === deleteRoleId);
  const addRole = (): void => {
    const role = createCustomAgentRoleDraft();
    autofocusId.current = role.id;
    onUpdate((current) => [...current, role]);
    onSelect(role.id);
  };
  const deleteRole = (id: string): void => {
    const index = roles.findIndex((role) => role.id === id);
    const remaining = roles.filter((role) => role.id !== id);
    onUpdate(() => remaining);
    onSelect(remaining[index]?.id ?? remaining[index - 1]?.id ?? null);
  };
  return (
    <SettingsListEditor
      title="Custom agent roles"
      description="Reusable instructions for workspace chats."
      items={roles.map((role) => {
        const errors = validation.errorsById[role.id];
        const count = Number(Boolean(errors?.name)) + Number(Boolean(errors?.systemPrompt));
        return {
          id: role.id,
          label: roleLabel(role),
          errorTitle:
            count > 0 ? `${count} custom role field error${count > 1 ? "s" : ""}` : undefined,
        };
      })}
      selectedId={selectedRole?.id ?? null}
      disabled={disabled}
      addLabel="Add role"
      onSelect={onSelect}
      onAdd={addRole}
    >
      {selectedRole ? (
        <CustomAgentRoleEditor
          role={selectedRole}
          errors={validation.errorsById[selectedRole.id] ?? {}}
          disabled={disabled}
          shouldAutofocusName={autofocusId.current === selectedRole.id}
          onNameAutofocused={() => {
            autofocusId.current = null;
          }}
          onDelete={() => setDeleteRoleId(selectedRole.id)}
          onChange={(field, value) =>
            onUpdate((current) =>
              current.map((role) =>
                role.id === selectedRole.id ? { ...role, [field]: value } : role,
              ),
            )
          }
        />
      ) : (
        <SettingsListEditorEmptyState
          title="Create your first custom agent role"
          addLabel="Add custom agent role"
          disabled={disabled}
          onAdd={addRole}
        >
          <p className="text-sm text-muted-foreground">
            Save reusable instructions for a code reviewer, a research assistant, or another agent
            you use often.
          </p>
          <p className="text-xs text-muted-foreground">
            Choose the role when you start a chat. Roles are available in every workspace.
          </p>
        </SettingsListEditorEmptyState>
      )}
      {roleToDelete && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setDeleteRoleId(null);
          }}
        >
          <DialogContent className="p-0 sm:max-w-md">
            <DialogHeader className="border-b border-border px-6 py-4">
              <DialogTitle>Delete custom agent role</DialogTitle>
              <DialogDescription>
                Delete "{roleLabel(roleToDelete)}" from your settings?
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="px-6 py-4 text-sm text-muted-foreground">
              Existing chats keep their original role. Save Settings to apply this deletion.
            </DialogBody>
            <DialogFooter className="mt-0 border-t border-border px-6 py-4">
              <Button type="button" variant="outline" onClick={() => setDeleteRoleId(null)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={disabled}
                onClick={() => {
                  deleteRole(roleToDelete.id);
                  setDeleteRoleId(null);
                }}
              >
                Delete role
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </SettingsListEditor>
  );
}

function CustomAgentRoleEditor({
  role,
  errors,
  disabled,
  shouldAutofocusName,
  onNameAutofocused,
  onDelete,
  onChange,
}: {
  role: CustomAgentRole;
  errors: CustomAgentRoleFieldErrors;
  disabled: boolean;
  shouldAutofocusName: boolean;
  onNameAutofocused: () => void;
  onDelete: () => void;
  onChange: (field: "name" | "systemPrompt", value: string) => void;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!shouldAutofocusName || disabled) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
    onNameAutofocused();
  }, [disabled, onNameAutofocused, shouldAutofocusName]);
  const nameInputId = `custom-role-${role.id}-name`;
  const promptInputId = `custom-role-${role.id}-prompt`;
  return (
    <SettingsListEditorCard
      title={roleLabel(role)}
      description="Choose this role when you start a new workspace chat."
      disabled={disabled}
      onDelete={onDelete}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameInputId}>Name</Label>
        <Input
          id={nameInputId}
          ref={nameInputRef}
          value={role.name}
          disabled={disabled}
          placeholder="Code reviewer"
          aria-invalid={errors.name ? true : undefined}
          onChange={(event) => onChange("name", event.target.value)}
        />
        {errors.name ? (
          <p className="text-xs text-destructive">{errors.name}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Shown in the role menu when you create a chat.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={promptInputId}>System prompt</Label>
        <Textarea
          id={promptInputId}
          value={role.systemPrompt}
          disabled={disabled}
          rows={12}
          placeholder="Describe the agent's purpose, what it should focus on, and how it should respond."
          aria-invalid={errors.systemPrompt ? true : undefined}
          onChange={(event) => onChange("systemPrompt", event.target.value)}
        />
        {errors.systemPrompt ? (
          <p className="text-xs text-destructive">{errors.systemPrompt}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            New chats use these instructions. Existing chats keep their original role.
          </p>
        )}
      </div>
    </SettingsListEditorCard>
  );
}
