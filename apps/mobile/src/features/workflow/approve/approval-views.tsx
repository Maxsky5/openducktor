import type { GitConflict } from "@openducktor/frontend-core/git/contracts";
import {
  getGitConflictCopy,
  gitConflictDescription,
} from "@openducktor/frontend-core/git/conflicts/conflict-copy";
import { createGitConflictActionsModel } from "@openducktor/frontend-core/git/conflicts/git-conflict-actions-model";
import { RESULT_UNKNOWN_TITLE } from "@openducktor/frontend-core/lib/command-outcome";
import { canonicalTargetBranch } from "@openducktor/frontend-core/lib/target-branch";
import {
  directMergeCompletionButtonLabel,
  directMergeCompletionStageDescription,
  getDirectMergeCompletionContextError,
  missingBuilderWorktreeConfirmLabel,
  TASK_APPROVAL_COPY as COPY,
  type TaskApprovalTextWithCode,
  taskApprovalCompletionNextStepText,
  taskApprovalLocalMergeReadyText,
  taskApprovalPublicationCommitLabel,
  taskApprovalSquashCommitHint,
  taskApprovalUncommittedChangesMessage,
} from "@openducktor/frontend-core/tasks/approval/task-approval-copy";
import { getTaskApprovalModalHeader } from "@openducktor/frontend-core/tasks/approval/task-approval-modal-header";
import type {
  TaskApprovalApprovalModalModel,
  TaskApprovalCompletionModalModel,
  TaskApprovalMissingBuilderWorktreeModalModel,
  TaskApprovalModalModel,
  TaskGitConflictDialogModel,
} from "@openducktor/frontend-core/tasks/approval/task-approval-types";
import { Children, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useLinkOpener } from "@/rich-content/links/use-link-opener";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Button } from "@/ui/button";
import { SegmentedControl, TextField } from "@/ui/fields";
import { Icon, type IconName } from "@/ui/icon";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { ActionForm } from "@/ui/action-form";
import { FormBody, FormLead, FormPanel, OptionCard, SectionLabel } from "@/ui/form-rows";
import { type ApprovalChoices, approvalChoices } from "./approval-method-model";

/** A sentence with a branch or path in the code font, as the desktop approval text. */
function CodeText({
  text,
  tone = "tertiary",
}: {
  text: TaskApprovalTextWithCode;
  tone?: "tertiary" | "label";
}): ReactElement {
  return (
    <Text variant="subhead" tone={tone}>
      {text.before}
      <Text variant="mono" tone="label">
        {text.code}
      </Text>
      {text.after}
    </Text>
  );
}

/** Notices above the form, with the screen padding. It renders nothing without a notice. */
function Notices({ children }: { children: ReactNode }): ReactElement | null {
  if (Children.toArray(children).length === 0) return null;
  return <View style={styles.notices}>{children}</View>;
}

/** The failure of the last submit, or null when it did not fail. */
const errorNotice = (model: TaskApprovalModalModel, title: string): ReactElement | null =>
  model.errorMessage ? (
    <Callout
      tone={model.errorOutcomeUnknown ? "warning" : "destructive"}
      title={model.errorOutcomeUnknown ? RESULT_UNKNOWN_TITLE : title}
      message={model.errorMessage}
    />
  ) : null;

/**
 * A desktop status panel: a tinted card with an icon tile, a title, and a body. `info` is a step
 * that is done; `warning` a state that needs a choice.
 */
function TonePanel({
  tone,
  icon,
  title,
  message,
  children,
}: {
  tone: "info" | "warning";
  icon: IconName;
  title: string;
  message?: string | undefined;
  children?: ReactNode;
}): ReactElement {
  const theme = useAppTheme();
  const colors =
    tone === "info"
      ? {
          border: theme.desktop.infoBorder,
          surface: theme.desktop.infoSurface,
          muted: theme.desktop.infoMuted,
          text: theme.desktop.infoSurfaceForeground,
        }
      : {
          border: theme.desktop.warningBorder,
          surface: theme.desktop.warningSurface,
          muted: theme.desktop.warningMuted,
          text: theme.desktop.warningSurfaceForeground,
        };
  return (
    <View
      style={[styles.tonePanel, { borderColor: colors.border, backgroundColor: colors.surface }]}
    >
      <View style={[styles.toneIcon, { borderColor: withAlpha(colors.border, 0.6) }]}>
        <Icon name={icon} size={20} colorValue={colors.muted} />
      </View>
      <View style={styles.toneText}>
        <Text variant="subhead" weight="semibold" style={{ color: colors.text }}>
          {title}
        </Text>
        {message ? (
          <Text variant="subhead" style={{ color: colors.text }}>
            {message}
          </Text>
        ) : null}
        {children}
      </View>
    </View>
  );
}

/** The labeled group of one approval choice, as the desktop sections. */
function ChoiceSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionLabel text={label} />
      {children}
    </View>
  );
}

/**
 * The approval step, as the desktop approval dialog: the approval action, then the merge method
 * and squash message of a Direct Merge, or the draft of a Pull Request. `notice` shows above the
 * choices, such as a Git provider read failure with Try Again.
 */
export function ApprovalStep({
  model,
  notice,
}: {
  model: TaskApprovalApprovalModalModel;
  notice: ReactNode;
}): ReactElement {
  const choices = approvalChoices(model);
  const busy = model.isSubmitting;
  return (
    <ActionForm
      note={choices.confirmBlockedReason}
      primary={
        <Button
          label={choices.confirmLabel}
          size="lg"
          loading={busy}
          command
          disabled={choices.confirmDisabled}
          onPress={model.onConfirm}
          fill
        />
      }
    >
      <Notices>
        {notice}
        {model.hasUncommittedChanges ? (
          <Callout
            tone="warning"
            title={COPY.uncommittedChangesTitle}
            message={taskApprovalUncommittedChangesMessage(model.uncommittedFileCount)}
          />
        ) : null}
        {errorNotice(model, COPY.approvalFailedTitle)}
      </Notices>
      <FormBody>
        <FormLead text={getTaskApprovalModalHeader(model).description} />
        {model.isLoading ? (
          <ApprovalLoading />
        ) : (
          <ApprovalChoiceForm model={model} choices={choices} />
        )}
      </FormBody>
    </ActionForm>
  );
}

/** The approval step while it reads the task and the repository. */
function ApprovalLoading(): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.loading} accessibilityRole="progressbar">
      <ActivityIndicator color={theme.desktop.statusRunning} />
      <View style={styles.loadingText}>
        <Text variant="subhead" weight="medium" style={styles.centered}>
          {COPY.loadingTitle}
        </Text>
        <Text variant="subhead" tone="tertiary" style={styles.centered}>
          {COPY.loadingDescription}
        </Text>
      </View>
    </View>
  );
}

/** The approval action, the Direct Merge choices, the Pull Request choices, and an existing pull request. */
function ApprovalChoiceForm({
  model,
  choices,
}: {
  model: TaskApprovalApprovalModalModel;
  choices: ApprovalChoices;
}): ReactElement {
  const openLink = useLinkOpener(undefined);
  const busy = model.isSubmitting;
  const { pullRequestUrl } = model;
  return (
    <>
      {choices.modes.length > 1 ? (
        <ChoiceSection label={COPY.approvalActionLabel}>
          <SegmentedControl
            label={COPY.approvalActionAccessibilityLabel}
            options={choices.modes}
            value={model.mode}
            onChange={model.onModeChange}
            disabled={busy}
          />
          {choices.pullRequestUnavailable ? (
            <Text variant="subhead" tone="tertiary">
              {choices.pullRequestUnavailable}
            </Text>
          ) : null}
        </ChoiceSection>
      ) : null}
      <MergeChoices model={model} choices={choices} />
      <PullRequestChoices model={model} choices={choices} />
      {pullRequestUrl ? (
        <Button
          label="Open Existing Pull Request"
          variant="plain"
          icon="external-link"
          accessibilityHint="Opens the pull request in the browser."
          onPress={() => openLink(pullRequestUrl)}
        />
      ) : null}
    </>
  );
}

/** The merge method and the squash message of a Direct Merge. */
function MergeChoices({
  model,
  choices,
}: {
  model: TaskApprovalApprovalModalModel;
  choices: ApprovalChoices;
}): ReactElement {
  const busy = model.isSubmitting;
  return (
    <>
      {choices.mergeMethods ? (
        <ChoiceSection label={COPY.mergeMethodLabel}>
          <View style={styles.cards} accessibilityRole="radiogroup">
            {choices.mergeMethods.map((option) => (
              <OptionCard
                key={option.value}
                title={option.label}
                description={option.description}
                selected={model.mergeMethod === option.value}
                disabled={busy}
                onPress={() => model.onMergeMethodChange(option.value)}
              />
            ))}
          </View>
        </ChoiceSection>
      ) : null}
      {choices.showSquashMessage ? (
        <FormPanel>
          <TextField
            label={COPY.squashCommitMessageLabel}
            value={model.squashCommitMessage}
            onChangeText={model.onSquashCommitMessageChange}
            placeholder={COPY.squashCommitMessagePlaceholder}
            multiline
            editable={!busy}
            error={choices.squashMessageError ? COPY.squashCommitMessageRequired : null}
            style={styles.squash}
          />
          <CodeText text={taskApprovalSquashCommitHint(model.targetBranch)} />
        </FormPanel>
      ) : null}
    </>
  );
}

/** The draft choice of a Pull Request, its title and description, or the generation notice. */
function PullRequestChoices({
  model,
  choices,
}: {
  model: TaskApprovalApprovalModalModel;
  choices: ApprovalChoices;
}): ReactElement {
  const busy = model.isSubmitting;
  return (
    <>
      {choices.draftModes ? (
        <ChoiceSection label={COPY.pullRequestDraftLabel}>
          <View style={styles.cards} accessibilityRole="radiogroup">
            {choices.draftModes.map((option) => (
              <OptionCard
                key={option.value}
                title={option.label}
                description={option.description}
                selected={model.pullRequestDraftMode === option.value}
                disabled={busy}
                onPress={() => model.onPullRequestDraftModeChange(option.value)}
              />
            ))}
          </View>
        </ChoiceSection>
      ) : null}
      {choices.showPullRequestFields ? (
        <FormPanel>
          <TextField
            label={COPY.pullRequestTitleLabel}
            value={model.title}
            onChangeText={model.onTitleChange}
            editable={!busy}
          />
          <TextField
            label={COPY.pullRequestDescriptionLabel}
            value={model.body}
            onChangeText={model.onBodyChange}
            editable={!busy}
            multiline
            style={styles.body}
          />
        </FormPanel>
      ) : null}
      {choices.draftModes && model.pullRequestDraftMode === "generate_ai" ? (
        <FormPanel muted>
          <Text variant="subhead" tone="tertiary">
            {COPY.generatePullRequestNotice}
          </Text>
        </FormPanel>
      ) : null}
    </>
  );
}

/** The builder worktree is gone: complete the task, or reset the implementation. */
export function MissingWorktreeStep({
  model,
}: {
  model: TaskApprovalMissingBuilderWorktreeModalModel;
}): ReactElement {
  const busy = model.isSubmitting;
  return (
    <ActionForm
      secondary={
        <Button
          label={COPY.resetImplementation}
          variant="outline"
          size="lg"
          disabled={busy}
          accessibilityHint="Asks you to confirm the reset first."
          onPress={model.onResetMissingBuilderWorktree}
          fill
        />
      }
      primary={
        <Button
          label={missingBuilderWorktreeConfirmLabel(busy)}
          size="lg"
          loading={busy}
          command
          disabled={busy}
          onPress={model.onCompleteMissingBuilderWorktree}
          fill
        />
      }
    >
      <Notices>{errorNotice(model, COPY.recoveryFailedTitle)}</Notices>
      <FormBody>
        <FormLead text={getTaskApprovalModalHeader(model).description} />
        <TonePanel
          tone="warning"
          icon="triangle-alert"
          title={COPY.missingWorktreeTitle}
          message={COPY.missingWorktreeDescription}
        />
        <FormPanel>
          <Text variant="subhead" weight="semibold">
            {COPY.nextStepChoiceTitle}
          </Text>
          <Text variant="subhead" tone="tertiary">
            {COPY.nextStepChoiceDescription}
          </Text>
        </FormPanel>
      </FormBody>
    </ActionForm>
  );
}

/** One branch box of the completion step, as the desktop local and remote boxes. */
function BranchBox({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.branchBox}>
      <SectionLabel text={label} />
      <Text variant="mono" selectable>
        {value}
      </Text>
      {children}
    </View>
  );
}

/** A completion that failed, or whose result the connection lost. */
function CompletionFailure({
  message,
  outcomeUnknown,
}: {
  message: string;
  outcomeUnknown: boolean;
}): ReactElement {
  return (
    <Callout
      tone={outcomeUnknown ? "warning" : "destructive"}
      title={outcomeUnknown ? RESULT_UNKNOWN_TITLE : COPY.completionFailedTitle}
      message={message}
    />
  );
}

/** The remote branch that the completion updates, with the commit and the remotes it pushes to. */
function PublishTarget({
  target,
  preview,
}: {
  target: NonNullable<TaskApprovalCompletionModalModel["publishTarget"]>;
  preview: TaskApprovalCompletionModalModel["publicationPreview"];
}): ReactElement {
  return (
    <>
      <View style={styles.arrow}>
        <Icon name="arrow-down" size={16} color="tertiaryLabel" />
      </View>
      <BranchBox label={COPY.remoteToUpdateLabel} value={canonicalTargetBranch(target)}>
        {preview ? (
          <View style={styles.preview}>
            <Text variant="footnote" tone="tertiary">
              {taskApprovalPublicationCommitLabel(preview.sourceOid)}
            </Text>
            {preview.destinations.map((destination) => (
              <Text key={destination.identity} variant="footnote" tone="tertiary">
                {destination.label}
              </Text>
            ))}
          </View>
        ) : null}
      </BranchBox>
    </>
  );
}

/** The local merge is applied: publish it when the target has a remote, then mark the task done. */
export function CompletionStep({
  model,
}: {
  model: TaskApprovalCompletionModalModel;
}): ReactElement {
  const busy = model.isSubmitting;
  const contextError = getDirectMergeCompletionContextError(model);
  const failure = contextError ?? model.errorMessage;
  const localBranch = model.targetBranch?.branch ?? "";
  return (
    <ActionForm
      note={directMergeCompletionStageDescription(model)}
      secondary={
        <Button
          label={COPY.finishLater}
          variant="outline"
          size="lg"
          disabled={busy}
          onPress={model.onSkipDirectMergeCompletion}
          fill
        />
      }
      primary={
        <Button
          label={directMergeCompletionButtonLabel(model)}
          size="lg"
          loading={busy}
          command
          disabled={busy || contextError !== null}
          onPress={model.onCompleteDirectMerge}
          fill
        />
      }
    >
      <Notices>
        {failure ? (
          <CompletionFailure
            message={failure}
            outcomeUnknown={contextError === null && model.errorOutcomeUnknown}
          />
        ) : null}
      </Notices>
      <FormBody>
        <FormLead text={getTaskApprovalModalHeader(model).description} />
        {contextError ? null : (
          <>
            <TonePanel tone="info" icon="check" title={COPY.localMergeReadyTitle}>
              <CodeText text={taskApprovalLocalMergeReadyText(localBranch)} tone="label" />
            </TonePanel>
            <FormPanel>
              <Text variant="subhead" weight="semibold">
                {COPY.nextStepTitle}
              </Text>
              <CodeText text={taskApprovalCompletionNextStepText(model)} />
              <BranchBox label={COPY.localBranchLabel} value={localBranch} />
              {model.publishTarget ? (
                <PublishTarget target={model.publishTarget} preview={model.publicationPreview} />
              ) : null}
            </FormPanel>
          </>
        )}
      </FormBody>
    </ActionForm>
  );
}

/**
 * A direct merge that stopped on a Git Conflict, as the desktop conflict dialog: the conflicted
 * files and the Git output, then Abort or the request to the Builder.
 */
export function ConflictStep({
  dialog,
  conflict,
}: {
  dialog: TaskGitConflictDialogModel;
  conflict: GitConflict;
}): ReactElement {
  const copy = getGitConflictCopy(conflict.operation);
  const actions = createGitConflictActionsModel({
    operation: conflict.operation,
    isHandlingConflict: dialog.isHandlingConflict,
    conflictAction: dialog.conflictAction,
    onAbort: dialog.onAbort,
    onAsk: dialog.onAskBuilder,
  });
  const { help } = actions;
  const abort = (
    <Button
      label={actions.abort.label}
      icon="rotate-ccw"
      variant="outline"
      size="lg"
      loading={actions.abort.isPending}
      command
      disabled={actions.abort.isDisabled}
      onPress={actions.abort.onClick}
      fill
    />
  );
  return (
    <ActionForm
      note={help?.blockedReason ?? null}
      secondary={help ? abort : null}
      primary={
        help ? (
          <Button
            label={help.label}
            icon="sparkles"
            size="lg"
            loading={help.isPending}
            command
            disabled={help.isDisabled}
            onPress={help.onClick}
            fill
          />
        ) : (
          abort
        )
      }
    >
      <FormBody>
        <FormLead text={gitConflictDescription(conflict)} />
        <View style={styles.section}>
          <SectionLabel text={copy.title} />
          <Text variant="subhead" tone="tertiary">
            {"Target branch "}
            <Text variant="mono" tone="label">
              {conflict.targetBranch}
            </Text>
          </Text>
        </View>
        <View style={styles.section}>
          <SectionLabel text={`Conflicted files (${conflict.conflictedFiles.length})`} />
          <FormPanel>
            {conflict.conflictedFiles.length === 0 ? (
              <Text variant="subhead" tone="tertiary">
                Unavailable
              </Text>
            ) : (
              conflict.conflictedFiles.map((path) => (
                <View key={path} style={styles.file}>
                  <Icon name="file-warning" size={14} color="amberText" />
                  <Text
                    variant="mono"
                    tone="secondary"
                    numberOfLines={2}
                    ellipsizeMode="middle"
                    selectable
                    style={styles.fileName}
                  >
                    {path}
                  </Text>
                </View>
              ))
            )}
          </FormPanel>
        </View>
        <View style={styles.section}>
          <SectionLabel text="Git output" />
          <View style={styles.output}>
            <Text variant="monoSmall" selectable>
              {conflict.output || "Unavailable"}
            </Text>
          </View>
        </View>
      </FormBody>
    </ActionForm>
  );
}

const styles = StyleSheet.create((theme) => ({
  notices: {
    gap: theme.space.sm,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
  },
  loading: {
    minHeight: 200,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.md,
    padding: theme.space.xxl,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.insetFill,
  },
  loadingText: { gap: 2 },
  centered: { textAlign: "center" },
  section: { gap: theme.space.md },
  cards: { gap: theme.space.md },
  squash: { minHeight: 112, textAlignVertical: "top" },
  body: { minHeight: 200, textAlignVertical: "top" },
  tonePanel: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.lg,
    padding: theme.space.xl,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
  },
  toneIcon: {
    width: 40,
    height: 40,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: withAlpha(theme.desktop.card, 0.7),
  },
  toneText: { flex: 1, gap: 6 },
  branchBox: {
    gap: theme.space.sm,
    padding: theme.space.lg,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.panelFill,
  },
  arrow: { alignItems: "center" },
  preview: { gap: 2 },
  file: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  fileName: { flex: 1 },
  // The output grows with its text, so the form scrolls through all of it.
  output: {
    padding: theme.space.md,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.muted,
  },
}));
