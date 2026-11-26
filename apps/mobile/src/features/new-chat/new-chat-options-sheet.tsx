import {
  type GitTargetBranch,
  UPSTREAM_TARGET_BRANCH,
  type WorkspaceRecord,
  type WorkspaceSessionLocation,
} from "@openducktor/contracts";
import type { WorkspaceSessionDraftOptions } from "@openducktor/frontend-core/drafts/new-workspace-session-draft-store";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  canonicalTargetBranch,
  targetBranchFromSelection,
  targetBranchSelectionValue,
} from "@openducktor/frontend-core/lib/target-branch";
import {
  NO_CUSTOM_AGENT_ROLE,
  type WorkspaceSessionDraftOptionsModel,
} from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import {
  worktreeDirectoryName,
  worktreeFolderName,
} from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";
import { type ReactElement, useMemo, useState } from "react";
import { ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { BranchPickerSheet } from "@/features/branches/branch-picker-sheet";
import { EffortField, ModelField, SpeedField } from "@/features/model-picker/model-field";
import { effortPlaceholder, modelSummary } from "@/features/model-picker/model-field-model";
import { verticalTouchSlop } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { FormBody, FormField, MenuSelect } from "@/ui/form-rows";
import { Icon, type IconName } from "@/ui/icon";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { blurFocusedField } from "@/ui/keyboard-dismiss";
import type { OptionChoice } from "@/ui/option-picker-model";
import { OptionPickerSheet } from "@/ui/option-picker-sheet";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { LocationOptionsSheet } from "./new-chat-location-sheet";
import type { NewChatModel } from "./use-new-chat-model";

const CHIP_HEIGHT = 32;
const CHIP_SLOP = verticalTouchSlop(CHIP_HEIGHT);

type OpenOptionSheet = "workspace" | "location" | "target" | "role" | null;

const targetLabel = (target: GitTargetBranch): string =>
  target.branch === UPSTREAM_TARGET_BRANCH ? "Tracked upstream" : canonicalTargetBranch(target);

const locationChipLabel = (options: WorkspaceSessionDraftOptions): string => {
  if (options.location === "local_repo_root") return "Current checkout";
  if (options.location === "existing_worktree") {
    return options.existingWorktreeDirectory
      ? worktreeFolderName(options.existingWorktreeDirectory)
      : "Existing worktree";
  }
  if (options.worktree.mode === "from_branch") {
    return options.worktree.branchName || "New worktree";
  }
  const dir = worktreeDirectoryName(options.worktree.name);
  return dir ? `Worktree: ${dir}` : "New worktree";
};

const resolveRoleChipLabel = (
  selectedRoleName: string | null,
  customAgentRoleId: string | null,
): string => {
  if (selectedRoleName) return selectedRoleName;
  return customAgentRoleId ? "Missing role" : "No role";
};

const locationChipIcon = (location: WorkspaceSessionLocation): IconName => {
  if (location === "local_repo_root") return "folder";
  if (location === "existing_worktree") return "folder-git-2";
  return "git-branch";
};

function OptionChip({
  icon,
  label,
  hasError = false,
  disabled,
  accessibilityLabel,
  onPress,
}: {
  icon: IconName;
  label: string;
  hasError?: boolean | undefined;
  disabled: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}): ReactElement {
  return (
    <Touchable
      feedback="scale"
      onPress={() => {
        blurFocusedField();
        onPress();
      }}
      disabled={disabled}
      radius={999}
      hitSlop={CHIP_SLOP}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[styles.chip, hasError ? styles.chipError : null]}
    >
      <Icon name={icon} size={13} color={hasError ? "red" : "secondaryLabel"} />
      <Text
        variant="footnote"
        weight="medium"
        numberOfLines={1}
        style={hasError ? styles.chipErrorLabel : styles.chipLabel}
      >
        {label}
      </Text>
      <Icon name="chevron-down" size={12} color={hasError ? "red" : "tertiaryLabel"} />
    </Touchable>
  );
}

/**
 * Compact option chips above the draft composer, with native in-place sheets for work location,
 * worktree choices, target branch, custom role, and workspace switching.
 */
export function NewChatOptionChips({
  workspace,
  workspaces,
  optionsModel,
  disabled,
  onSwitchWorkspace,
}: {
  workspace: WorkspaceRecord;
  workspaces: readonly WorkspaceRecord[];
  optionsModel: WorkspaceSessionDraftOptionsModel;
  disabled: boolean;
  onSwitchWorkspace: (workspaceId: string) => void;
}): ReactElement {
  const [openSheet, setOpenSheet] = useState<OpenOptionSheet>(null);
  const closeSheet = () => setOpenSheet(null);

  const {
    options,
    effectiveTargetBranch,
    roles,
    branches,
    fieldErrors,
    selectedRoleName,
    targetBranchChoices,
    roleChoices: draftRoleChoices,
    onSelectTargetBranch,
    onSelectRole,
  } = optionsModel;

  const roleLabel = resolveRoleChipLabel(selectedRoleName, options.customAgentRoleId);

  const roleChoices = useMemo<OptionChoice[] | undefined>(
    () =>
      draftRoleChoices?.map((choice) => ({
        value: choice.value,
        label: choice.label,
        detail: choice.description,
        disabled: choice.disabled,
      })),
    [draftRoleChoices],
  );

  const workspaceChoices = useMemo<OptionChoice[]>(
    () =>
      workspaces.map((entry) => ({
        value: entry.workspaceId,
        label: entry.workspaceName,
        detail: entry.repoPath,
      })),
    [workspaces],
  );

  const locationHasError = Boolean(
    fieldErrors.worktreeName || fieldErrors.worktreeBranch || fieldErrors.existingWorktree,
  );

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.chipRow}
      >
        {workspaces.length > 1 ? (
          <OptionChip
            icon="folder-open"
            label={workspace.workspaceName}
            disabled={disabled}
            accessibilityLabel={`Workspace: ${workspace.workspaceName}`}
            onPress={() => setOpenSheet("workspace")}
          />
        ) : null}
        <OptionChip
          icon={locationChipIcon(options.location)}
          label={locationChipLabel(options)}
          hasError={locationHasError}
          disabled={disabled}
          accessibilityLabel={`Work location: ${locationChipLabel(options)}`}
          onPress={() => setOpenSheet("location")}
        />
        <OptionChip
          icon="git-compare"
          label={effectiveTargetBranch ? targetLabel(effectiveTargetBranch) : "Target branch"}
          hasError={Boolean(fieldErrors.targetBranch)}
          disabled={disabled}
          accessibilityLabel={`Target branch: ${effectiveTargetBranch ? targetLabel(effectiveTargetBranch) : "Unset"}`}
          onPress={() => setOpenSheet("target")}
        />
        <OptionChip
          icon="bot"
          label={roleLabel}
          hasError={Boolean(fieldErrors.role)}
          disabled={disabled}
          accessibilityLabel={`Custom role: ${roleLabel}`}
          onPress={() => setOpenSheet("role")}
        />
      </ScrollView>

      <OptionPickerSheet
        visible={openSheet === "workspace"}
        title="Workspace"
        searchPlaceholder="Search workspaces"
        choices={workspaceChoices}
        selected={workspace.workspaceId}
        emptyMessage="No workspaces are open."
        onSelect={onSwitchWorkspace}
        onClose={closeSheet}
      />

      <LocationOptionsSheet
        visible={openSheet === "location"}
        onClose={closeSheet}
        optionsModel={optionsModel}
        disabled={disabled}
      />

      <BranchPickerSheet
        visible={openSheet === "target"}
        title="Target branch"
        hint="Compare this session's changes with this branch."
        choices={targetBranchChoices}
        error={branches.error}
        onRetry={() => void branches.refetch()}
        selected={effectiveTargetBranch ? targetBranchSelectionValue(effectiveTargetBranch) : null}
        onSelect={(value) => onSelectTargetBranch(targetBranchFromSelection(value))}
        onClose={closeSheet}
      />

      <OptionPickerSheet
        visible={openSheet === "role"}
        title="Custom role"
        searchPlaceholder="Search custom roles"
        hint="Choose an optional custom agent role from host settings."
        choices={roleChoices}
        error={roles.error}
        errorTitle="Custom roles did not load"
        loadingLabel="Loading custom roles…"
        onRetry={() => void roles.refetch()}
        selected={options.customAgentRoleId ?? NO_CUSTOM_AGENT_ROLE}
        emptyMessage="This host has no custom roles."
        onSelect={onSelectRole}
        onClose={closeSheet}
      />
    </>
  );
}

/** In-place sheet for picking the draft's runtime, model, effort, speed, and profile. */
export function DraftModelOptionsSheet({
  visible,
  onClose,
  model,
  repoConfig,
  disabled,
}: {
  visible: boolean;
  onClose: () => void;
  model: NewChatModel;
  repoConfig: WorkspaceSessionDraftOptionsModel["repoConfig"];
  disabled: boolean;
}): ReactElement {
  const modelName = modelSummary(model.runtimes, model.selection).title;
  return (
    <InPlaceSheet visible={visible} title="Message Options" onClose={onClose}>
      <FormBody>
        <ModelField
          runtimes={model.runtimes}
          favorites={model.favorites}
          selection={model.selection}
          placeholder={model.state.kind === "loading" ? "Loading models…" : "Select a model"}
          disabled={disabled}
          error={model.error}
          onOpen={model.onCatalogSelectorOpen}
          onChoose={model.selectModel}
        />
        {repoConfig.isError ? (
          <Callout
            tone="destructive"
            title="The repository Default Model did not load"
            message={errorMessage(repoConfig.error)}
            action={
              <Button
                label="Retry"
                variant="gray"
                size="sm"
                onPress={() => void repoConfig.refetch()}
              />
            }
          />
        ) : null}
        <EffortField
          effort={{
            options: model.variantOptions,
            value: model.selection?.variant,
            placeholder: effortPlaceholder({
              loading: model.state.kind === "loading",
              hasModel: model.selection !== null,
            }),
            caption: modelName ?? "Effort",
            disabled,
            onSelect: model.handleSelectVariant,
          }}
        />
        <SpeedField
          key={model.speed?.key}
          control={model.speed}
          caption={modelName ?? "Speed"}
          disabled={disabled}
        />
        {model.supportsProfiles ? (
          <FormField label="Runtime profile">
            <MenuSelect
              title="Runtime profile"
              icon="bot"
              choices={model.agentProfileOptions}
              selected={model.selection?.profileId}
              placeholder="Runtime default"
              disabled={disabled}
              onSelect={model.handleSelectAgentProfile}
            />
          </FormField>
        ) : null}
      </FormBody>
    </InPlaceSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  chipRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.xs,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.xs,
  },
  chip: {
    minHeight: CHIP_HEIGHT,
    maxWidth: 200,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  chipError: {
    borderColor: theme.colors.redBorder,
    backgroundColor: theme.colors.redSoft,
  },
  chipLabel: {
    flexShrink: 1,
    color: theme.colors.label,
  },
  chipErrorLabel: {
    flexShrink: 1,
    color: theme.colors.redText,
  },
}));
