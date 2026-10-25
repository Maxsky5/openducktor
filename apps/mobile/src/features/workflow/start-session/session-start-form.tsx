import {
  buildSessionStartConfirmDraft,
  resolveSessionStartAvailability,
  type SessionStartModalModel,
} from "@openducktor/frontend-core/sessions/start/session-start-modal-model";
import {
  sessionStartModelPlaceholder,
  sessionStartModelReadOnlyReason,
  sessionStartRuntimeProfileHelperText,
  sessionStartTargetBranchPlaceholder,
  sessionStartVariantPlaceholder,
} from "@openducktor/frontend-core/sessions/start/session-start-display";
import {
  BLANK_KICKOFF_PROMPT_ERROR,
  useSessionStartKickoffDraft,
} from "@openducktor/frontend-core/sessions/start/use-session-start-kickoff-draft";
import { useSessionStartSpeed } from "@openducktor/frontend-core/sessions/start/use-session-start-speed";
import { type ReactElement, type ReactNode, useMemo, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { OptionPickerSheet } from "@/ui/option-picker-sheet";
import { BranchPickerSheet } from "@/features/branches/branch-picker-sheet";
import { EffortField, ModelField, SpeedField } from "@/features/model-picker/model-field";
import { modelSummary } from "@/features/model-picker/model-field-model";
import { motion } from "@/theme/tokens";
import { Button } from "@/ui/button";
import { SegmentedControl, SwitchRow, TextField } from "@/ui/fields";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { ActionForm } from "@/ui/action-form";
import type { BranchesFailure } from "../use-workspace-repo-settings";
import { FormBody, FormField, FormLead, MenuSelect, SelectTrigger } from "@/ui/form-rows";
import {
  optionLabel,
  reportingChoices,
  reportingSpeed,
  startFormSections,
  startModeOptions,
  titleCase,
} from "./start-form-model";

const NO_EDIT_REPORT = (): void => {};

/** The read failures of a start, each with Try Again when the read can repeat. */
function StartNotices({
  model,
  branchesFailure,
}: {
  model: SessionStartModalModel;
  branchesFailure: BranchesFailure | null;
}): ReactElement | null {
  const runtimeSettingsFailed = !model.hasRuntimeSettingsSnapshot && model.runtimeSettingsError;
  const reuse = model.selectedStartMode === "reuse";
  if (
    !model.runtimeDefinitionsError &&
    !runtimeSettingsFailed &&
    !(model.selectionCatalogError && !reuse) &&
    !model.kickoffPromptError &&
    !branchesFailure
  ) {
    return null;
  }
  return (
    <View style={styles.notices}>
      {branchesFailure ? (
        <Callout
          tone="destructive"
          title="Branches did not load"
          message={branchesFailure.message}
          action={
            <Button label="Try Again" size="sm" variant="gray" onPress={branchesFailure.retry} />
          }
        />
      ) : null}
      {model.runtimeDefinitionsError ? (
        <Callout
          tone="destructive"
          title="Runtimes did not load"
          message={model.runtimeDefinitionsError}
          action={
            <Button
              label="Try Again"
              size="sm"
              variant="gray"
              onPress={model.onRetryRuntimeDefinitions}
            />
          }
        />
      ) : null}
      {runtimeSettingsFailed ? (
        <Callout
          tone="destructive"
          title="Runtime settings did not load"
          message={model.runtimeSettingsError}
          action={
            <Button
              label="Try Again"
              size="sm"
              variant="gray"
              onPress={model.onRetryRuntimeSettings}
            />
          }
        />
      ) : null}
      {model.selectionCatalogError && !reuse ? (
        <Callout
          tone="destructive"
          title="Models did not load"
          message={model.selectionCatalogError}
        />
      ) : null}
      {model.kickoffPromptError ? (
        <Callout
          tone="destructive"
          title="The kickoff prompt did not load"
          message={model.kickoffPromptError}
          action={
            model.onRetryKickoffPrompt ? (
              <Button
                label="Try Again"
                size="sm"
                variant="gray"
                onPress={model.onRetryKickoffPrompt}
              />
            ) : undefined
          }
        />
      ) : null}
    </View>
  );
}

/** A read that the start waits for, as the desktop status lines with a spinner. */
function LoadingLine({ label }: { label: string }): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator size="small" color={theme.desktop.mutedForeground} />
      <Text variant="callout" tone="tertiary">
        {label}
      </Text>
    </View>
  );
}

/** The loading line of the model field while the runtimes or their settings load. */
const modelLoadingLabel = (model: SessionStartModalModel): string | null => {
  if (model.runtimeDefinitionsError) return null;
  if (model.isRuntimeDefinitionsLoading) return "Loading agent runtimes…";
  if (!model.hasRuntimeSettingsSnapshot && model.isRuntimeSettingsLoading) {
    return "Loading runtime settings…";
  }
  return null;
};

/**
 * The session start, as the desktop start dialog on a phone: the description, the session mode,
 * the source session, the target branch, the runtime and model with its effort and speed, the
 * runtime profile, and the kickoff prompt. The footer holds Run in Background and Start Session,
 * with the reason why Start is disabled.
 */
export function SessionStartForm({
  model: shown,
  branchesFailure,
  notices,
  onEdit = NO_EDIT_REPORT,
}: {
  model: SessionStartModalModel;
  /** The failed branch list read, which the target branch choice needs. */
  branchesFailure: BranchesFailure | null;
  /** Notices above the choices, such as a first message that did not reach its session. */
  notices?: ReactNode;
  /** Runs when the user changes a choice. */
  onEdit?: (() => void) | undefined;
}): ReactElement {
  const model = useMemo(() => ({ ...shown, ...reportingChoices(shown, onEdit) }), [onEdit, shown]);
  const speed = useSessionStartSpeed(model);
  const kickoff = useSessionStartKickoffDraft({
    requestId: model.requestId,
    open: model.open,
    prompt: model.kickoffPrompt,
  });
  const availability = resolveSessionStartAvailability(model, { kickoffInvalid: kickoff.invalid });

  const sections = startFormSections(model);
  const modes = startModeOptions(model);
  const selection = model.selectedModelSelection;
  const modelName = modelSummary(model.modelPickerRuntimes, selection).title;
  const busy = model.isStarting;
  const { confirmDisabled, blockedReason } = availability;
  const confirm = (runInBackground: boolean) => {
    model.onConfirm({
      runInBackground,
      ...buildSessionStartConfirmDraft({
        model,
        requiresExistingSession: availability.requiresExistingSession,
        speedChange: speed.change,
        kickoffPrompt: kickoff.value,
      }),
    });
  };

  const choosesTargetBranch = sections.targetBranch && model.onSelectTargetBranch !== undefined;
  const profileHint = sessionStartRuntimeProfileHelperText({
    runtimeProfileCount: model.runtimeProfileOptions.length,
    isReuseMode: availability.isReuseMode,
    isSelectionCatalogLoading: model.isSelectionCatalogLoading,
  });

  return (
    <ActionForm
      note={blockedReason}
      secondary={
        model.allowRunInBackground ? (
          <Button
            label={titleCase(model.backgroundConfirmLabel ?? "Run in background")}
            variant="gray"
            size="lg"
            command
            disabled={confirmDisabled}
            accessibilityHint="Starts the session and keeps this screen."
            onPress={() => confirm(true)}
            fill
          />
        ) : null
      }
      primary={
        <Button
          label={titleCase(model.confirmLabel)}
          variant="filled"
          size="lg"
          loading={busy}
          command
          disabled={confirmDisabled}
          accessibilityHint="Starts the session and opens it."
          onPress={() => confirm(false)}
          fill
        />
      }
    >
      {notices}
      <StartNotices model={model} branchesFailure={choosesTargetBranch ? branchesFailure : null} />
      <FormBody>
        <FormLead text={model.description} />
        {modes.length > 0 ? (
          <FormField label="Session Mode">
            <SegmentedControl
              label="Session mode"
              options={modes}
              value={model.selectedStartMode}
              onChange={model.onSelectStartMode}
              disabled={busy}
            />
          </FormField>
        ) : null}
        {sections.sourceSession ? <SourceSessionField model={model} busy={busy} /> : null}
        {sections.targetBranch && model.onSelectTargetBranch ? (
          <TargetBranchField model={model} onSelect={model.onSelectTargetBranch} busy={busy} />
        ) : null}
        <RuntimeModelField model={model} reuse={availability.isReuseMode} busy={busy} />
        <EffortField
          effort={{
            options: model.variantOptions,
            value: selection?.variant,
            placeholder: sessionStartVariantPlaceholder({
              isSelectionCatalogLoading: model.isSelectionCatalogLoading,
              hasSelectedModel: selection !== null,
              supportsVariants: model.supportsVariants,
              variantCount: model.variantOptions.length,
            }),
            caption: modelName ?? "Effort",
            disabled: availability.variantDisabled,
            onSelect: model.onSelectVariant,
          }}
        />
        <SpeedField
          key={speed.control?.key}
          control={reportingSpeed(speed.control, onEdit)}
          caption={modelName ?? "Speed"}
          disabled={busy}
        />
        {sections.profile ? (
          <FormField label="Runtime profile" hint={profileHint}>
            <MenuSelect
              title="Runtime profile"
              icon="bot"
              choices={model.runtimeProfileOptions}
              selected={selection?.profileId}
              placeholder="Select runtime profile"
              disabled={availability.runtimeProfileDisabled}
              onSelect={model.onSelectRuntimeProfile}
            />
          </FormField>
        ) : null}
        {model.isKickoffPromptLoading ? <LoadingLine label="Loading kickoff prompt…" /> : null}
        {kickoff.hasPrompt ? (
          <KickoffPromptField kickoff={kickoff} busy={busy} onEdit={onEdit} />
        ) : null}
      </FormBody>
    </ActionForm>
  );
}

/** The session that a fork or a reuse starts from, with its picker. */
function SourceSessionField({
  model,
  busy,
}: {
  model: SessionStartModalModel;
  busy: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const options = model.existingSessionOptions;
  const empty = options.length === 0;
  return (
    <FormField
      label="Existing Session"
      hint={empty ? "This task has no session to start from." : null}
    >
      <SelectTrigger
        value={optionLabel(options, model.selectedSourceSessionValue)}
        placeholder="Select session"
        icon="message-square"
        disabled={busy || empty}
        onPress={() => setOpen(true)}
        accessibilityLabel="Existing session"
        accessibilityHint="Opens the sessions of this task."
      />
      <OptionPickerSheet
        visible={open}
        title="Existing Session"
        searchPlaceholder="Search sessions"
        choices={options.map((option) => ({
          value: option.value,
          label: option.label,
          detail: option.description ?? option.secondaryLabel ?? null,
          disabled: option.disabled,
        }))}
        selected={model.selectedSourceSessionValue}
        emptyMessage="This task has no session to start from."
        onSelect={model.onSelectSourceSessionValue}
        onClose={() => setOpen(false)}
      />
    </FormField>
  );
}

/** The branch that the Builder merges into, with its picker. */
function TargetBranchField({
  model,
  onSelect,
  busy,
}: {
  model: SessionStartModalModel;
  onSelect: (branch: string) => void;
  busy: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const branchOptions = model.targetBranchOptions ?? [];
  return (
    <FormField
      label="Target branch"
      hint="The Builder merges into this branch."
      error={model.targetBranchError}
    >
      <SelectTrigger
        value={optionLabel(branchOptions, model.selectedTargetBranch)}
        placeholder={sessionStartTargetBranchPlaceholder(branchOptions.length)}
        icon="git-branch"
        mono
        disabled={busy || branchOptions.length === 0}
        onPress={() => setOpen(true)}
        accessibilityLabel="Target branch"
        accessibilityHint="Opens the branches of the repository."
      />
      <BranchPickerSheet
        visible={open}
        title="Target Branch"
        choices={branchOptions}
        selected={model.selectedTargetBranch}
        onSelect={onSelect}
        onClose={() => setOpen(false)}
      />
    </FormField>
  );
}

/** The runtime and model field, or its loading line while the runtimes or their settings load. */
function RuntimeModelField({
  model,
  reuse,
  busy,
}: {
  model: SessionStartModalModel;
  /** A reused session keeps its model. */
  reuse: boolean;
  busy: boolean;
}): ReactElement {
  const loading = modelLoadingLabel(model);
  if (loading) {
    return (
      <FormField label="Runtime and model">
        <LoadingLine label={loading} />
      </FormField>
    );
  }
  return (
    <ModelField
      runtimes={model.modelPickerRuntimes}
      favorites={model.favoriteState.favorites}
      selection={model.selectedModelSelection}
      placeholder={sessionStartModelPlaceholder(model.isSelectionCatalogLoading)}
      disabled={busy}
      readOnlyReason={reuse ? sessionStartModelReadOnlyReason(busy) : null}
      onChoose={model.onSelectModelPair}
    />
  );
}

/** The switch that customizes the kickoff prompt, and the prompt field while it is on. */
function KickoffPromptField({
  kickoff,
  busy,
  onEdit,
}: {
  kickoff: ReturnType<typeof useSessionStartKickoffDraft>;
  busy: boolean;
  onEdit: () => void;
}): ReactElement {
  return (
    <View style={styles.kickoff}>
      <View style={styles.switch}>
        <SwitchRow
          label="Customize kickoff prompt"
          description="Replace the first message that this action sends to the agent."
          value={kickoff.enabled}
          onValueChange={(enabled) => {
            onEdit();
            kickoff.setEnabled(enabled);
          }}
          disabled={busy}
        />
      </View>
      {kickoff.enabled ? (
        <Animated.View entering={FadeIn.duration(motion.base)}>
          <TextField
            label="Kickoff prompt"
            value={kickoff.text}
            onChangeText={(text) => {
              onEdit();
              kickoff.setText(text);
            }}
            multiline
            editable={!busy}
            error={kickoff.invalid ? BLANK_KICKOFF_PROMPT_ERROR : null}
            style={styles.promptInput}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  notices: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
  },
  loading: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 36 },
  kickoff: { gap: theme.space.lg },
  switch: {
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    overflow: "hidden",
  },
  promptInput: { minHeight: 180, maxHeight: 360, textAlignVertical: "top" },
}));
