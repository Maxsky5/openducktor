import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  NO_CUSTOM_AGENT_ROLE,
  type useWorkspaceSessionCreate,
} from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-create";
import type { ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import { FormField, MenuSelect, OptionCard } from "@/ui/form-rows";
import { Callout } from "@/ui/callout";

type CreateForm = ReturnType<typeof useWorkspaceSessionCreate>;

/** The custom role of the host settings, with its load state. */
export function CustomRoleField({
  form,
  disabled,
}: {
  form: CreateForm;
  disabled: boolean;
}): ReactElement {
  const { roles } = form;
  const loaded = roles.data ?? [];
  const choices = [
    { value: NO_CUSTOM_AGENT_ROLE, label: "No role" },
    ...loaded.map((role) => ({ value: role.id, label: role.name })),
  ];
  let placeholder = "No role";
  if (roles.isPending) placeholder = "Loading roles…";
  else if (roles.isError) placeholder = "Roles did not load";
  return (
    <>
      <FormField
        label="Custom role"
        optional
        hint={
          roles.isSuccess && loaded.length === 0
            ? "This host has no custom roles. Add them in the OpenDucktor settings on the host."
            : null
        }
      >
        <MenuSelect
          title="Custom role"
          choices={choices}
          selected={roles.isSuccess ? form.roleId : null}
          placeholder={placeholder}
          disabled={disabled || !roles.isSuccess}
          onSelect={form.setRoleId}
        />
      </FormField>
      {roles.isError ? (
        <Callout
          tone="destructive"
          title="Custom roles did not load"
          message={errorMessage(roles.error)}
          action={
            <Button
              label="Try Again"
              variant="gray"
              size="sm"
              onPress={() => void roles.refetch()}
            />
          }
        />
      ) : null}
    </>
  );
}

/** The current checkout, a new worktree, or a worktree that exists. */
export function WorkLocationField({
  form,
  disabled,
}: {
  form: CreateForm;
  disabled: boolean;
}): ReactElement {
  return (
    <FormField label="Work location">
      <View style={styles.locations} accessibilityRole="radiogroup">
        <OptionCard
          variant="primary"
          icon="folder"
          title="Current checkout"
          description="Work with the files already here."
          selected={form.location === "local_repo_root"}
          disabled={disabled}
          onPress={() => form.selectLocation("local_repo_root")}
        />
        <OptionCard
          variant="primary"
          icon="git-branch"
          title="New worktree"
          description="Use an isolated directory and branch."
          selected={form.location === "local_worktree"}
          disabled={disabled}
          onPress={() => form.selectLocation("local_worktree")}
        />
        <OptionCard
          variant="primary"
          icon="folder-git-2"
          title="Existing worktree"
          description="Use a worktree that already exists."
          selected={form.location === "existing_worktree"}
          disabled={disabled}
          onPress={() => form.selectLocation("existing_worktree")}
        />
      </View>
    </FormField>
  );
}

const styles = StyleSheet.create((theme) => ({
  locations: { gap: theme.space.sm },
}));
