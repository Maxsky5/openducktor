import type { WorkflowLibraryRole } from "@openducktor/contracts";
import { roleInputOf } from "@openducktor/workflows";
import { useMemo } from "react";
import { useRoleFormDialog } from "../roles/role-form-dialog";
import { duplicateRoleInput, newRoleInput } from "../roles/role-input";
import type { EditorRoleCommands } from "./inspector/inspector-context";
import { bindRole } from "./model/document-edits";
import type { EditorStore } from "./model/editor-store";

/**
 * The role commands of the editor and their form. A new role binds in the draft. A copy takes
 * the place of its role in an editable draft. Role saves stay outside undo.
 */
export const useEditorRoleCommands = (
  store: EditorStore,
  libraryRoles: readonly WorkflowLibraryRole[],
) => {
  const { openRole, dialog } = useRoleFormDialog(libraryRoles);
  const roles = useMemo<EditorRoleCommands>(() => {
    const catalogRoles = libraryRoles.map(({ role }) => role);
    return {
      newRole: () =>
        openRole({
          mode: "create",
          input: newRoleInput(catalogRoles),
          onSaved: (role) => store.getState().create((document) => bindRole(document, role.id)),
        }),
      editRole: (roleId) => {
        const entry = libraryRoles.find(({ role }) => role.id === roleId);
        if (entry)
          openRole({
            mode: entry.source === "builtin" ? "view" : "update",
            input: roleInputOf(entry.role),
          });
      },
      duplicateRole: (roleId) => {
        const role = catalogRoles.find(({ id }) => id === roleId);
        if (!role) return;
        openRole({
          mode: "create",
          input: duplicateRoleInput(role, catalogRoles),
          onSaved: (copy) => {
            const state = store.getState();
            if (!state.readOnly && state.document.definition.roles.some(({ id }) => id === roleId))
              state.rename("role", roleId, copy.id);
          },
        });
      },
    };
  }, [libraryRoles, openRole, store]);
  return { roles, roleDialog: dialog };
};
