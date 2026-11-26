import type { WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  draftToSerializedText,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { WorkspaceSessionDraft } from "@openducktor/frontend-core/drafts/new-workspace-session-draft-store";
import { useDraftViewLease } from "@openducktor/frontend-core/drafts/use-new-workspace-session-drafts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import {
  type ComposerPolicyModel,
  useComposerPolicy,
} from "@openducktor/frontend-core/sessions/composer/agent-chat-composer-policy";
import { useAgentChatComposerDraftState } from "@openducktor/frontend-core/sessions/composer/use-agent-chat-composer-draft-state";
import { useWorkspaceSessionDraftCore } from "@openducktor/frontend-core/workspace-sessions/create/use-workspace-session-draft-core";
import { useNavigation, useRouter } from "expo-router";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFeedbackStore } from "@/app-shell/app-services";
import { draftFlushVisibility } from "@/composition/app-visibility";
import { useMobileWorkspaces } from "@/composition/workspace-selection";
import {
  composerCardState,
  composerFieldText,
  composerModelText,
  sendButtonState,
} from "@/features/composer/composer-presentation";
import { useComposerDraftEditor } from "@/features/composer/use-composer-draft-editor";
import { useComposerInteractions } from "@/features/composer/use-composer-interactions";
import { useModelFavorites } from "@/features/model-picker/use-model-favorites";
import { useCommandGate } from "@/host-session/active-session-context";
import { closeScreen } from "@/navigation/close-screen";
import { workspaceSessionRoute } from "@/navigation/routes";
import { haptics } from "@/ui/haptics";
import { blurFocusedField } from "@/ui/keyboard-dismiss";
import { useBottomEdgePadding } from "@/ui/keyboard-inset-view";
import { useCompactHeight } from "@/ui/use-wide-layout";
import { resolveNewChatModelReadiness, toNewChatModel } from "./use-new-chat-model";
import { useDiscardWorkspaceDraft } from "./use-open-workspace-chat";

export type SavedUnboundState = {
  record: WorkspaceSession;
  attemptId: string;
  submittedComposer: AgentChatComposerDraft | null;
};

export type NewChatDraftViewProps = {
  workspace: WorkspaceRecord;
  draft: WorkspaceSessionDraft;
  onSavedUnbound: (recovery: SavedUnboundState) => void;
};

export function useNewChatDraftController({
  workspace,
  draft,
  onSavedUnbound,
}: NewChatDraftViewProps) {
  const connection = useClientConnection();
  const draftStore = connection.drafts.newWorkspaceSessions;
  const { feedback } = useFeedbackStore();
  const { workspaces } = useMobileWorkspaces();
  const { favorites } = useModelFavorites();
  const gate = useCommandGate();
  const compact = useCompactHeight();
  const navigation = useNavigation();
  const router = useRouter();
  const discardDraft = useDiscardWorkspaceDraft();

  const [modelSheetOpen, setModelSheetOpen] = useState(false);
  const handedOffRef = useRef(false);
  const isHandedOff = useCallback(() => handedOffRef.current, []);
  const markHandedOff = useCallback(() => {
    handedOffRef.current = true;
  }, []);

  const draftId = draft.id;
  useDraftViewLease(draftId, true);

  const composerPersistence = useMemo(
    () => draftStore.composerPersistence(draftId),
    [draftId, draftStore],
  );
  const draftScope = useMemo(
    () => ({
      key: composerPersistence.targetKey,
      persistence: composerPersistence,
    }),
    [composerPersistence],
  );
  const draftState = useAgentChatComposerDraftState({
    scope: draftScope,
    visibility: draftFlushVisibility,
  });
  const editor = useComposerDraftEditor({
    draft: draftState.draft,
    commitDraft: draftState.commitDraft,
  });

  const core = useWorkspaceSessionDraftCore({
    workspaceId: workspace.workspaceId,
    repoPath: workspace.repoPath,
    draft,
    composer: draftState.draft,
    isHostConnected: gate.open,
    resolveModelReadiness: resolveNewChatModelReadiness,
  });

  const repoSettingsError = core.optionsModel.repoConfig.error
    ? errorMessage(core.optionsModel.repoConfig.error)
    : null;
  const model = useMemo(
    () =>
      toNewChatModel(
        core.model,
        core.defaultModelSelection,
        {
          pending: core.optionsModel.repoConfig.isPending,
          error: repoSettingsError,
        },
        favorites,
      ),
    [
      core.defaultModelSelection,
      core.model,
      core.optionsModel.repoConfig.isPending,
      favorites,
      repoSettingsError,
    ],
  );

  const isReadOnly = core.startup.showingTranscript;
  const policyModel: ComposerPolicyModel = {
    selectedModelDescriptor: model.selectedModelEntry,
    runningTurnModel: null,
    isSessionWorking: false,
    foregroundTurnActive: false,
    isSending: core.startup.isStarting,
    isStarting: core.startup.isStarting,
    isInteractionEnabled: !core.startup.isStarting,
    isReadOnly,
    canSend: !isReadOnly && core.validation.canSubmit,
    isWaitingInput: false,
    isResumingSession: false,
    speed: model.speed,
    supportsAttachments: core.promptInput.support.supportsAttachments,
    steerBlockedReason: null,
    supportsFileSearch: core.promptInput.support.supportsFileSearch,
    supportsSubagentReferences: core.promptInput.support.supportsSubagentReferences,
    supportsSlashCommands: core.promptInput.slashCommands.supportsSlashCommands,
    supportsSkillReferences: core.promptInput.support.supportsSkillReferences,
    readOnlyReason: core.startup.readOnlyReason,
    externalSendBlockedReason: core.startup.showingTranscript
      ? null
      : core.validation.sendBlockedReason,
    waitingInputPlaceholder: null,
    messageQueue: null,
  };
  const policy = useComposerPolicy({
    model: policyModel,
    draft: draftState.draft,
    primaryMode: "default",
    settingsReady: true,
    steerShortcutLabel: null,
  });
  const fieldText = composerFieldText({
    placeholder: policy.placeholder,
    hints: policy.placeholderHints,
  });

  const submitStateRef = useRef({
    canSubmit: core.validation.canSubmit,
    sendDisabled: policy.sendDisabled,
  });
  useLayoutEffect(() => {
    submitStateRef.current = {
      canSubmit: core.validation.canSubmit,
      sendDisabled: policy.sendDisabled,
    };
  }, [core.validation.canSubmit, policy.sendDisabled]);

  const { submit: submitCore, switchWorkspace: switchWorkspaceCore, discardPolicy } = core.actions;
  const { setPreSaveError } = core;
  const { isStarting } = core.startup;
  const { workspaceId } = workspace;

  const handleSend = useCallback(async () => {
    const currentSubmit = submitStateRef.current;
    if (isStarting || !currentSubmit.canSubmit || currentSubmit.sendDisabled) return;
    const submittedDraft = editor.draftRef.current;
    if (!draftHasMeaningfulContent(submittedDraft)) return;
    haptics.light();
    blurFocusedField();
    try {
      await submitCore({
        submittedComposer: submittedDraft,
        onSavedRecord: (record, attemptId) => {
          if (record.externalSessionId === null) {
            markHandedOff();
            onSavedUnbound({ record, attemptId, submittedComposer: submittedDraft });
          }
        },
        onBoundRecord: (record, attemptId) => {
          const boundRoute = workspaceSessionRoute(workspaceId, record, attemptId);
          if (!boundRoute || isHandedOff()) return;
          markHandedOff();
          if (navigation.isFocused()) {
            router.replace(boundRoute);
            return;
          }
          onSavedUnbound({ record, attemptId, submittedComposer: submittedDraft });
        },
      });
    } catch (cause) {
      const err = cause instanceof Error ? cause : new Error(String(cause));
      setPreSaveError(err);
      feedback.show("error", err.message);
    }
  }, [
    editor.draftRef,
    feedback,
    isHandedOff,
    isStarting,
    markHandedOff,
    navigation,
    onSavedUnbound,
    router,
    setPreSaveError,
    submitCore,
    workspaceId,
  ]);

  const sendDraft = useCallback(() => {
    void handleSend();
  }, [handleSend]);

  const handleDiscard = useCallback(() => {
    if (discardPolicy === "blocked") return;
    blurFocusedField();
    discardDraft(draftId, discardPolicy, () => {
      markHandedOff();
      closeScreen(navigation);
    });
  }, [discardDraft, discardPolicy, draftId, markHandedOff, navigation]);

  const handleSwitchWorkspace = useCallback(
    (nextWorkspaceId: string) => {
      const result = switchWorkspaceCore(nextWorkspaceId);
      if (result.switched) {
        router.setParams({ workspaceId: nextWorkspaceId, draftId });
      }
    },
    [draftId, router, switchWorkspaceCore],
  );

  const openModelSheet = useCallback(() => {
    blurFocusedField();
    model.onCatalogSelectorOpen();
    setModelSheetOpen(true);
  }, [model]);

  const interactions = useComposerInteractions({
    draft: draftState.draft,
    editor,
    promptInput: core.promptInput,
    attachmentSupport: model.selectedModelEntry?.attachmentSupport,
    isInputDisabled: policy.isComposerInputDisabled,
    attachmentsEnabled: !core.startup.showingTranscript && !policy.isComposerInputDisabled,
    sendDisabled: policy.sendDisabled,
    onSend: sendDraft,
  });

  const keyboardPadding = useBottomEdgePadding(8);
  const modelDisplay = composerModelText({
    selectedModel: model.selection,
    modelName: model.selectedModelEntry?.modelName,
    catalog: model.catalog,
  });
  const hasContent = useMemo(() => draftHasMeaningfulContent(draftState.draft), [draftState.draft]);
  const sendState = sendButtonState({
    hasContent,
    sendDisabled: policy.sendDisabled,
    busy: policy.isSubmitting,
  });
  const cardState = composerCardState({
    isWaitingInput: false,
    inputDisabled: policy.isComposerInputDisabled,
    isSubmitting: policy.isSubmitting,
  });

  const submittedSource = core.startup.submittedComposer ?? draftState.draft;
  const submittedText = draftToSerializedText(submittedSource);
  const submittedAttachmentCount = submittedSource.attachments?.length ?? 0;

  return {
    ui: {
      workspaces,
      compact,
      preSaveError: core.preSaveError,
      hostValidationError: core.hostValidationError,
      modelSheetOpen,
      setModelSheetOpen,
    },
    startup: {
      attemptId: core.startup.attemptId,
      isAttemptPending: core.startup.isAttemptPending,
      isStarting: core.startup.isStarting,
      showingTranscript: core.startup.showingTranscript,
      isReadOnly,
      submittedText,
      submittedAttachmentCount,
      isHandedOff,
    },
    optionsModel: core.optionsModel,
    model,
    composer: {
      draft: draftState.draft,
      editor,
      policy,
      fieldText,
      promptInput: core.promptInput,
      keyboardPadding,
      modelDisplay,
      sendState,
      cardState,
      ...interactions,
    },
    actions: {
      send: sendDraft,
      discard: handleDiscard,
      switchWorkspace: handleSwitchWorkspace,
      openModelSheet,
    },
  };
}

export type NewChatDraftController = ReturnType<typeof useNewChatDraftController>;
