import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import type { WorkspaceRecord } from "@openducktor/contracts";
import {
  TasksStateContext,
  useRequiredContext,
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { RESULT_UNKNOWN_TITLE } from "@openducktor/frontend-core/lib/command-outcome";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useGlobalRemoveWorktreeOnClose } from "@openducktor/frontend-core/queries/use-global-remove-worktree-on-close";
import type { DeviceFileReference } from "@openducktor/frontend-core/platform/device-file";
import { useTaskCreateModalController } from "@openducktor/frontend-core/tasks/create/use-task-create-modal-controller";
import {
  PRIORITY_OPTIONS,
  REMOVE_WORKTREE_ON_CLOSE_LABEL,
  removeWorktreeOnCloseChoiceKey,
  removeWorktreeOnCloseChoices,
} from "@openducktor/frontend-core/tasks/create/task-composer-options";
import { taskDescriptionImageError } from "@openducktor/frontend-core/tasks/operations/use-task-description-asset-operations";
import { usePreventRemove, useRouter } from "expo-router";
import {
  memo,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandGate } from "@/host-session/active-session-context";
import { SheetScreen } from "@/navigation/sheet-screen";
import { readPickedFileBase64 } from "@/platform/attachment-stager";
import { pickDocuments, pickLibraryImages } from "@/platform/device-files";
import { ActionForm } from "@/ui/action-form";
import { Button } from "@/ui/button";
import { useConfirmDiscard } from "@/ui/confirm-discard";
import { SegmentedControl } from "@/ui/fields";
import { Screen } from "@/ui/screen";
import { Callout } from "@/ui/callout";
import { Text } from "@/ui/text";
import { blurFocusedField } from "@/ui/keyboard-dismiss";
import { useAnnounce } from "@/ui/use-announce";
import { ComposerStepper, EditSectionSwitcher } from "./composer-navigation";
import { pickedImagePreviewUri, releasePickedImagePreview } from "./description-image-files";
import {
  collectDescriptionAssetIds,
  insertAtCursor,
  TASK_IMAGE_PICKER_TYPES,
  taskImageMarkdown,
} from "./description-assets";
import { DocumentEditor } from "./document-editor";
import { FieldInput, FormField, ToolbarButton } from "./form-parts";
import { IssueTypeGrid, IssueTypeSummary } from "./issue-type-grid";
import { LabelsField } from "./labels-field";
import { MarkdownEditorField } from "./markdown-editor-field";
import { taskEditorSaveDisabled } from "./task-editor-model";

const PRIORITY_CHOICES = PRIORITY_OPTIONS.map((option) => ({
  value: String(option.value),
  label: option.label,
}));

type EditorController = ReturnType<typeof useTaskCreateModalController<DeviceFileReference>>;
type ConfirmDiscard = ReturnType<typeof useConfirmDiscard>;

/**
 * Asks before the controller drops edits. The controller makes new callbacks on each render, so
 * the confirmation reads the latest ones.
 */
const useDiscardConfirmation = (
  controller: EditorController,
  confirmDiscard: ConfirmDiscard,
): void => {
  const { pendingDiscardIntent } = controller;
  const discardActions = useRef({
    confirmDiscard: controller.confirmDiscard,
    clearPendingDiscardIntent: controller.clearPendingDiscardIntent,
  });
  useEffect(() => {
    discardActions.current = {
      confirmDiscard: controller.confirmDiscard,
      clearPendingDiscardIntent: controller.clearPendingDiscardIntent,
    };
  });
  useEffect(() => {
    if (!pendingDiscardIntent) return;
    void confirmDiscard({
      title: "Discard Changes?",
      message:
        pendingDiscardIntent.type === "close-modal"
          ? "Your edits are not saved."
          : "The document has edits that are not saved.",
    }).then((confirmed) => {
      if (confirmed) void discardActions.current.confirmDiscard();
      else discardActions.current.clearPendingDiscardIntent();
    });
  }, [confirmDiscard, pendingDiscardIntent]);
};

/**
 * Puts picked images into the description at the caret. Only an image insert reads the caret, so
 * a caret move does not render the sheet again.
 */
const useDescriptionImages = (controller: EditorController) => {
  const cursor = useRef<number | null>(null);
  const onCursorChange = useCallback((at: number) => {
    cursor.current = at;
  }, []);
  const [pickError, setPickError] = useState<string | null>(null);
  const { stageDescriptionImage, updateState } = controller;
  const description = controller.state.description;
  const addImages = useCallback(
    async (source: "library" | "files") => {
      setPickError(null);
      // The description gives up the focus, so Android does not open the keyboard over the sheet
      // when the picker closes.
      blurFocusedField();
      let files: DeviceFileReference[];
      try {
        files =
          source === "library"
            ? await pickLibraryImages({ multiple: true })
            : await pickDocuments({ types: TASK_IMAGE_PICKER_TYPES, multiple: true });
      } catch (cause) {
        setPickError(`The images could not open. ${errorMessage(cause)}`);
        return;
      }
      let text = description;
      let at = cursor.current ?? text.length;
      for (const file of files) {
        const invalid = taskDescriptionImageError(file);
        if (invalid) {
          setPickError(`${file.name}: ${invalid}`);
          continue;
        }
        try {
          // One image stages at a time, so the app holds one file in memory, and the images go
          // into the description in the order that the user picked them.
          // react-doctor-disable-next-line react-doctor/async-await-in-loop
          const staged = await stageDescriptionImage(file);
          const inserted = insertAtCursor(text, at, taskImageMarkdown(file.name, staged.assetId));
          text = inserted.text;
          at = inserted.cursor;
          updateState({ description: text });
        } catch (cause) {
          setPickError(`${file.name}: ${errorMessage(cause)}`);
        }
      }
      cursor.current = at;
    },
    [description, stageDescriptionImage, updateState],
  );
  return useMemo(
    () => ({ onCursorChange, pickError, addImages }),
    [addImages, onCursorChange, pickError],
  );
};

/**
 * Close, Back, and the iOS swipe ask before they drop edits. A running save blocks them, and a
 * save or a confirmed discard calls `allowRemoval` so the sheet can close.
 */
const useEditorClose = (
  controller: EditorController,
  confirmDiscard: ConfirmDiscard,
  allowRemoval: RefObject<() => void>,
) => {
  const { close, isBusy, isActiveDocumentDirty, mode } = controller;
  const dirty =
    controller.isTaskDraftDirty || Object.values(controller.dirtyDocuments).some(Boolean);
  const requestClose = useCallback(() => {
    // For an unsaved open document, the controller asks once through its discard intent.
    if (!dirty || isActiveDocumentDirty) {
      void close();
      return;
    }
    void confirmDiscard({
      title: mode === "create" ? "Discard the New Task?" : "Discard Changes?",
      message: "Your edits are not saved.",
    }).then((confirmed) => {
      if (confirmed) void close();
    });
  }, [close, confirmDiscard, dirty, isActiveDocumentDirty, mode]);
  const disablePrevention = usePreventRemove(dirty || isBusy, () => {
    if (!isBusy) requestClose();
  });
  useEffect(() => {
    allowRemoval.current = disablePrevention;
  }, [allowRemoval, disablePrevention]);
  return requestClose;
};

/** The footer action of the open section: create or save the task, or save the open document. */
const primaryActionLabel = (controller: EditorController): string | null => {
  if (controller.isTypeStepVisible) return null;
  if (controller.activeDocumentSection === "spec") {
    return controller.isSavingDocument ? "Saving Spec" : "Save Spec";
  }
  if (controller.activeDocumentSection === "plan") {
    return controller.isSavingDocument ? "Saving Plan" : "Save Plan";
  }
  if (controller.mode === "create")
    return controller.isSubmitting ? "Creating Task" : "Create Task";
  return controller.isSubmitting ? "Saving Changes" : "Save Changes";
};

/**
 * New task and Edit task. Edit also edits the Spec Document and the Implementation Plan. The
 * shared controller blocks a save when the live task shows a newer task or document version. The
 * footer has Cancel and the action of the open section, as the desktop dialog footer.
 */
export function TaskEditorSheet({
  workspace,
  task,
}: {
  workspace: WorkspaceRecord;
  task: TaskCard | null;
}): ReactElement {
  const router = useRouter();
  const gate = useCommandGate();
  const confirmDiscard = useConfirmDiscard();
  const { tasks } = useRequiredContext(TasksStateContext, "TaskEditorSheet");
  const destination = useMemo(
    () =>
      task ? null : { workspaceId: workspace.workspaceId, workspaceName: workspace.workspaceName },
    [task, workspace.workspaceId, workspace.workspaceName],
  );
  // The back guard of `useEditorClose` must let a save or a confirmed discard close the sheet.
  const allowRemoval = useRef<() => void>(() => {});
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      allowRemoval.current();
      router.back();
    },
    [router],
  );
  const controller = useTaskCreateModalController<DeviceFileReference>({
    open: true,
    onOpenChange,
    tasks,
    task,
    destination,
    readFileBase64: readPickedFileBase64,
    createPreviewUrl: pickedImagePreviewUri,
    revokePreviewUrl: releasePickedImagePreview,
    collectAssetIds: collectDescriptionAssetIds,
  });
  const { mode, editSection, isFormDisabled, isBusy } = controller;
  useDiscardConfirmation(controller, confirmDiscard);
  const images = useDescriptionImages(controller);
  const requestClose = useEditorClose(controller, confirmDiscard, allowRemoval);
  const imageContext = useMemo(() => taskImageContext(workspace, task), [task, workspace]);
  const primaryLabel = primaryActionLabel(controller);
  const titleMissing = editSection === "details" && controller.state.title.trim().length === 0;

  return (
    <SheetScreen
      title={mode === "create" ? "Create Task" : "Edit Task"}
      onClose={requestClose}
      closable={!isBusy}
    >
      <Screen background="sheet">
        <ActionForm
          note={editorNote({ shown: primaryLabel !== null, commandsOpen: gate.open, titleMissing })}
          primary={
            primaryLabel ? <EditorSaveButton controller={controller} label={primaryLabel} /> : null
          }
        >
          <View style={styles.content}>
            {mode === "create" ? (
              <CreateIntro
                step={controller.step}
                disabled={isFormDisabled}
                setStep={controller.setStep}
              />
            ) : (
              <EditIntro controller={controller} taskId={task?.id ?? null} />
            )}
            <View style={[styles.body, isFormDisabled && styles.disabled]}>
              <EditorContent controller={controller} imageContext={imageContext} images={images} />
            </View>
            {controller.footerError ? (
              <Callout
                tone={controller.footerErrorOutcomeUnknown ? "warning" : "destructive"}
                title={controller.footerErrorOutcomeUnknown ? RESULT_UNKNOWN_TITLE : "Not saved"}
                message={controller.footerError}
              />
            ) : null}
          </View>
        </ActionForm>
      </Screen>
    </SheetScreen>
  );
}

/** Creates or saves the task, or saves the open document, with the desktop save rules. */
function EditorSaveButton({
  controller,
  label,
}: {
  controller: EditorController;
  label: string;
}): ReactElement {
  const isTaskSection = controller.editSection === "details";
  const { activeDocument } = controller;
  const documentSaveBlocked =
    activeDocument === null || !activeDocument.loaded || activeDocument.isLoading;
  const saveDisabled = taskEditorSaveDisabled({
    busy: controller.isBusy,
    locked: controller.isSaveOrRecoveryLocked,
    documentSection: !isTaskSection,
    title: controller.state.title,
    typeStep: controller.mode === "create" && controller.isTypeStepVisible,
    conflict: controller.hasExternalTaskConflict,
    destinationError: controller.destinationError !== null,
    documentDirty: controller.isActiveDocumentDirty,
    documentDraft: controller.activeDraft,
  });
  return (
    <Button
      label={label}
      icon={controller.mode === "create" && isTaskSection ? "flag" : "wand-sparkles"}
      size="lg"
      loading={isTaskSection ? controller.isSubmitting : controller.isSavingDocument !== null}
      command
      disabled={saveDisabled || (!isTaskSection && documentSaveBlocked)}
      onPress={() => void (isTaskSection ? controller.submit() : controller.saveActiveDocument())}
      fill
    />
  );
}

/** Why the footer action waits, under the footer rule. */
const editorNote = ({
  shown,
  commandsOpen,
  titleMissing,
}: {
  shown: boolean;
  commandsOpen: boolean;
  titleMissing: boolean;
}): string | null => {
  if (!shown) return null;
  if (!commandsOpen)
    return "You can keep editing. Saving is available when the host connection is live.";
  return titleMissing ? "Enter a title." : null;
};

/** The images of an edited task load through the host, and those of its source issue too. */
const taskImageContext = (workspace: WorkspaceRecord, task: TaskCard | null) =>
  task
    ? {
        workspaceId: workspace.workspaceId,
        taskId: task.id,
        issue: task.sourceIssue
          ? { repoPath: workspace.repoPath, providerId: task.sourceIssue.providerId }
          : null,
      }
    : null;

/** The type and details steps of New Task. */
const CreateIntro = memo(function CreateIntro({
  step,
  disabled,
  setStep,
}: {
  step: EditorController["step"];
  disabled: boolean;
  setStep: EditorController["setStep"];
}): ReactElement {
  return (
    <ComposerStepper
      step={step}
      disabled={disabled}
      onStepChange={(nextStep) => {
        // The details step opens only through a type choice.
        if (nextStep === "details" && step !== "details") return;
        setStep(nextStep);
      }}
    />
  );
});

/** The text under the title of Edit Task, then its sections. */
function EditIntro({
  controller,
  taskId,
}: {
  controller: EditorController;
  taskId: string | null;
}): ReactElement {
  return (
    <>
      <Text variant="callout" tone="tertiary">
        {`Update ${taskId ?? "task"} metadata and long-form markdown documents.`}
      </Text>
      <EditSectionSwitcher
        section={controller.editSection}
        unsavedSpec={controller.dirtyDocuments.spec}
        unsavedPlan={controller.dirtyDocuments.plan}
        disabled={controller.isFormDisabled}
        onChange={controller.requestSectionChange}
      />
    </>
  );
}

/** The type step of a new task, the open document, or the task fields. */
function EditorContent({
  controller,
  imageContext,
  images,
}: {
  controller: EditorController;
  imageContext: ReturnType<typeof taskImageContext>;
  images: ReturnType<typeof useDescriptionImages>;
}): ReactElement | null {
  const { activeDocumentSection, activeDocument } = controller;
  if (controller.isTypeStepVisible) {
    return (
      <IssueTypeGrid
        selected={controller.selectedCreateIssueType}
        disabled={controller.isFormDisabled}
        onSelect={controller.selectCreateIssueType}
      />
    );
  }
  if (controller.editSection === "details") {
    return <TaskFields controller={controller} imageContext={imageContext} images={images} />;
  }
  if (!activeDocumentSection || !activeDocument) return null;
  return (
    <DocumentSection
      controller={controller}
      section={activeDocumentSection}
      document={activeDocument}
    />
  );
}

/** The Spec Document or the Implementation Plan in its Markdown editor. */
function DocumentSection({
  controller,
  section,
  document,
}: {
  controller: EditorController;
  section: NonNullable<EditorController["activeDocumentSection"]>;
  document: NonNullable<EditorController["activeDocument"]>;
}): ReactElement {
  const spec = section === "spec";
  return (
    <DocumentEditor
      key={section}
      title={spec ? "Specification" : "Implementation Plan"}
      subtitle={
        spec
          ? "Edit the canonical specification markdown for this task."
          : "Edit the implementation plan markdown for this task."
      }
      placeholder={spec ? "# Purpose\n\nDescribe expected outcome..." : "## Milestones\n\n- ..."}
      markdown={controller.activeDraft}
      view={controller.views[section] === "preview" ? "preview" : "write"}
      onViewChange={(view) => controller.setDocumentView(section, view)}
      updatedAt={document.updatedAt}
      isLoading={document.isLoading}
      editable={!controller.isFormDisabled && document.loaded}
      error={document.error}
      hasUnsavedChanges={controller.isActiveDocumentDirty}
      onMarkdownChange={(markdown) => controller.updateDocumentDraft(section, markdown)}
      onRevert={controller.discardCurrentDocumentDraft}
      onRetryLoad={() => void controller.loadDocumentSection(section, true)}
    />
  );
}

/**
 * The task fields: type, title, priority, AI Review, description with images, and labels. Each
 * field renders only when its own value changes, so a tap on a priority or on AI Review does not
 * render the description and the labels again.
 */
function TaskFields({
  controller,
  imageContext,
  images,
}: {
  controller: EditorController;
  imageContext: ReturnType<typeof taskImageContext>;
  images: ReturnType<typeof useDescriptionImages>;
}): ReactElement {
  const { state, updateState, isFormDisabled, setStep, mode } = controller;
  const editable = !isFormDisabled;
  const changeTitle = useCallback((title: string) => updateState({ title }), [updateState]);
  const changePriority = useCallback(
    (priority: number) => updateState({ priority }),
    [updateState],
  );
  const changeRemoveWorktreeOnClose = useCallback(
    (removeWorktreeOnClose: boolean | null) => updateState({ removeWorktreeOnClose }),
    [updateState],
  );
  const changeDescription = useCallback(
    (description: string) => updateState({ description }),
    [updateState],
  );
  const changeLabels = useCallback((labels: string[]) => updateState({ labels }), [updateState]);
  const showTypeStep = useCallback(() => setStep("type"), [setStep]);
  return (
    <>
      <IssueTypeField
        issueType={state.issueType}
        disabled={isFormDisabled}
        onChange={mode === "create" ? showTypeStep : null}
      />
      <TitleField value={state.title} editable={editable} onChange={changeTitle} />
      <PriorityField value={state.priority} editable={editable} onChange={changePriority} />
      <RemoveWorktreeOnCloseField
        value={state.removeWorktreeOnClose}
        editable={editable}
        onChange={changeRemoveWorktreeOnClose}
      />
      <DescriptionField
        value={state.description}
        editable={editable}
        onChange={changeDescription}
        imageContext={imageContext}
        stagedImages={controller.descriptionAssetPreviews}
        uploads={controller.descriptionAssetUploads}
        images={images}
      />
      <FormField label="Labels">
        <MemoLabelsField
          labels={state.labels}
          knownLabels={controller.knownLabels}
          editable={editable}
          onChange={changeLabels}
        />
      </FormField>
    </>
  );
}

const MemoLabelsField = memo(LabelsField);

const IssueTypeField = memo(function IssueTypeField({
  issueType,
  disabled,
  onChange,
}: {
  issueType: EditorController["state"]["issueType"];
  disabled: boolean;
  onChange: (() => void) | null;
}): ReactElement {
  return (
    <FormField label="Issue Type" required>
      <IssueTypeSummary issueType={issueType} disabled={disabled} onChange={onChange} />
    </FormField>
  );
});

const TitleField = memo(function TitleField({
  value,
  editable,
  onChange,
}: {
  value: string;
  editable: boolean;
  onChange: (title: string) => void;
}): ReactElement {
  return (
    <FormField label="Title" required>
      <FieldInput
        value={value}
        onChangeText={onChange}
        editable={editable}
        placeholder="Short task title"
        accessibilityLabel="Title"
        accessibilityHint="What needs to happen."
        multiline
        scrollEnabled={false}
        returnKeyType="done"
        submitBehavior="blurAndSubmit"
      />
    </FormField>
  );
});

const PriorityField = memo(function PriorityField({
  value,
  editable,
  onChange,
}: {
  value: number;
  editable: boolean;
  onChange: (priority: number) => void;
}): ReactElement {
  const priority = PRIORITY_OPTIONS.find((option) => option.value === value);
  return (
    <FormField
      label="Priority"
      required
      note={priority ? `${priority.label} · ${priority.hint} priority.` : null}
    >
      <SegmentedControl
        label="Priority"
        options={PRIORITY_CHOICES}
        value={String(value)}
        onChange={(next) => onChange(Number(next))}
        disabled={!editable}
      />
    </FormField>
  );
});

const RemoveWorktreeOnCloseField = memo(function RemoveWorktreeOnCloseField({
  value,
  editable,
  onChange,
}: {
  value: boolean | null;
  editable: boolean;
  onChange: (removeWorktreeOnClose: boolean | null) => void;
}): ReactElement {
  const choices = removeWorktreeOnCloseChoices(useGlobalRemoveWorktreeOnClose().data);
  // A segment is narrow on a phone, so the note names the global setting.
  const segments = choices.map(({ key, label }) => ({
    value: key,
    label: key === "default" ? "Default" : label,
  }));
  const selected = choices.find((choice) => choice.value === value);
  const note =
    selected && value === null
      ? `${selected.label}. ${selected.description}`
      : selected?.description;
  return (
    <FormField label={REMOVE_WORKTREE_ON_CLOSE_LABEL} note={note}>
      <SegmentedControl
        label={REMOVE_WORKTREE_ON_CLOSE_LABEL}
        options={segments}
        value={removeWorktreeOnCloseChoiceKey(value)}
        onChange={(key) => {
          const choice = choices.find((entry) => entry.key === key);
          if (choice) onChange(choice.value);
        }}
        disabled={!editable}
      />
    </FormField>
  );
});

const DescriptionField = memo(function DescriptionField({
  value,
  editable,
  onChange,
  imageContext,
  stagedImages,
  uploads,
  images,
}: {
  value: string;
  editable: boolean;
  onChange: (description: string) => void;
  imageContext: ReturnType<typeof taskImageContext>;
  stagedImages: EditorController["descriptionAssetPreviews"];
  uploads: EditorController["descriptionAssetUploads"];
  images: ReturnType<typeof useDescriptionImages>;
}): ReactElement {
  const { addImages } = images;
  return (
    <MarkdownEditorField
      label="Description"
      value={value}
      onChange={onChange}
      editable={editable}
      placeholder="Describe the task in Markdown"
      imageContext={imageContext}
      stagedImages={stagedImages}
      emptyPreview="Nothing to preview yet."
      onCursorChange={images.onCursorChange}
      toolbar={
        <>
          <ToolbarButton
            label="Photo Library"
            icon="image-plus"
            command
            disabled={!editable}
            onPress={() => void addImages("library")}
          />
          <ToolbarButton
            label="Files"
            icon="paperclip"
            command
            disabled={!editable}
            onPress={() => void addImages("files")}
          />
        </>
      }
      footer={<DescriptionUploads uploads={uploads} pickError={images.pickError} />}
    />
  );
});

/** The image uploads of the description and the last pick failure. */
function DescriptionUploads({
  uploads,
  pickError,
}: {
  uploads: EditorController["descriptionAssetUploads"];
  pickError: string | null;
}): ReactElement | null {
  if (uploads.length === 0 && !pickError) return null;
  return (
    <View style={styles.uploads} accessibilityLabel="Description image uploads">
      {uploads.map((upload) =>
        upload.status === "uploading" ? (
          <UploadStatus key={upload.id} text={`Uploading ${upload.fileName}…`} />
        ) : (
          <UploadStatus
            key={upload.id}
            failed
            text={`${upload.fileName}: ${upload.error ?? "Upload failed."}`}
          />
        ),
      )}
      {pickError ? <UploadStatus failed text={pickError} /> : null}
    </View>
  );
}

/** One line of the image uploads. Screen readers read each new line and each change. */
function UploadStatus({ text, failed = false }: { text: string; failed?: boolean }): ReactElement {
  useAnnounce(text);
  return failed ? (
    <Text variant="footnote" accessibilityLiveRegion="polite" style={styles.uploadError}>
      {text}
    </Text>
  ) : (
    <Text variant="footnote" tone="tertiary" accessibilityLiveRegion="polite">
      {text}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.space.lg,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.md,
  },
  body: { gap: theme.space.lg },
  disabled: { opacity: 0.55 },
  uploads: { gap: 2 },
  uploadError: { color: theme.desktop.destructiveMuted },
}));
