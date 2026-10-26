import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import { matchesAgentSessionIdentity } from "@openducktor/frontend-core/lib/agent-session-identity";
import { getAgentSessionWaitingInputPlaceholder } from "@openducktor/frontend-core/lib/agent-session-waiting-input";
import { useAsyncActivityTracker } from "@openducktor/frontend-core/lib/use-async-activity-tracker";
import { createAgentStudioChatDraftPersistence } from "@openducktor/frontend-core/sessions/composer/agent-studio-chat-draft";
import {
  type ComposerPolicyModel,
  useComposerPolicy,
} from "@openducktor/frontend-core/sessions/composer/agent-chat-composer-policy";
import { useSessionPromptInput } from "@openducktor/frontend-core/sessions/composer/prompt-input/use-session-prompt-input";
import { useAgentChatComposerDraftState } from "@openducktor/frontend-core/sessions/composer/use-agent-chat-composer-draft-state";
import { useAgentChatComposerSubmit } from "@openducktor/frontend-core/sessions/composer/use-agent-chat-composer-submit";
import { useAgentStudioChatSettings } from "@openducktor/frontend-core/sessions/composer/use-agent-studio-chat-settings";
import { useReviewCommentComposer } from "@openducktor/frontend-core/sessions/composer/use-review-comment-composer";
import { createWorkspaceSessionChatDraftPersistence } from "@openducktor/frontend-core/sessions/composer/workspace-session-chat-draft";
import {
  findModelEntry,
  findRunningTurnMessage,
} from "@openducktor/frontend-core/sessions/model-selection/model-selection-options";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { hasForegroundTurn } from "@openducktor/frontend-core/sessions/send/agent-chat-steering";
import {
  useAgentChatSend,
  type AgentChatSendTarget,
} from "@openducktor/frontend-core/sessions/send/use-agent-chat-send";
import type {
  AgentChatMessage,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { useCallback, useMemo, useState } from "react";
import { draftFlushVisibility } from "@/composition/app-visibility";
import { useCommandGate } from "@/host-session/active-session-context";
import { type SessionTarget, useSessionScreen } from "@/features/session/session-target";
import { useSessionFacts } from "@/features/session/use-session-facts";
import { useSessionRuntimeInfo } from "@/features/session/use-session-runtime-info";
import { useSessionSelector } from "@/features/session/use-session-selector";
import type { ComposerFailure } from "@openducktor/frontend-core/sessions/composer/composer-failure";
import { composerFieldText } from "./composer-presentation";
import { useComposerDraftEditor } from "./use-composer-draft-editor";

type ComposerSessionFacts = {
  /** The latest user message that names a model: it started or joined the running turn. */
  runningTurnMessage: AgentChatMessage | null;
  waitingInputPlaceholder: string | null;
};

const NO_FACTS: ComposerSessionFacts = Object.freeze({
  runningTurnMessage: null,
  waitingInputPlaceholder: null,
});

const selectComposerFacts = (session: AgentSessionState | null): ComposerSessionFacts => {
  if (!session) return NO_FACTS;
  return {
    runningTurnMessage: findRunningTurnMessage(session.messages.items),
    waitingInputPlaceholder: getAgentSessionWaitingInputPlaceholder(session),
  };
};

const EMPTY_MESSAGES: readonly AgentChatMessage[] = [];
const noop = (): void => {};

const inlineCommentOwnerOf = (target: SessionTarget): InlineCommentOwner | null => {
  const { workspaceId } = target.workspace;
  if (target.owner.kind === "task")
    return { kind: "task", workspaceId, taskId: target.owner.taskId };
  if (target.owner.kind === "chat") {
    return { kind: "workspace_session", workspaceId, sessionId: target.owner.record.id };
  }
  return null;
};

const RECIPIENT_CHANGED =
  "The session of this composer changed. Open the session again to send your draft.";

/** The draft of a composer, saved for its chat or for its task session. */
const useComposerDraft = (target: SessionTarget) => {
  const { drafts } = useClientConnection();
  const { identity, workspace, owner } = target;
  const chatRecordId = owner.kind === "chat" ? owner.record.id : null;
  const taskId = owner.kind === "task" ? owner.taskId : null;
  const persistence = useMemo(() => {
    if (chatRecordId) {
      return createWorkspaceSessionChatDraftPersistence(
        drafts.chat,
        workspace.workspaceId,
        chatRecordId,
      );
    }
    if (taskId) {
      return createAgentStudioChatDraftPersistence({
        drafts: drafts.chat,
        workspaceId: workspace.workspaceId,
        taskId,
        session: identity,
      });
    }
    return null;
  }, [chatRecordId, drafts.chat, identity, taskId, workspace.workspaceId]);
  const draftScope = useMemo(
    () => ({ key: persistence?.targetKey ?? target.sessionKey, persistence }),
    [persistence, target.sessionKey],
  );
  const draftState = useAgentChatComposerDraftState({
    scope: draftScope,
    visibility: draftFlushVisibility,
  });
  return { draftScope, draftState };
};

/** The other mode than the primary one, while a turn runs: Steer or Queue for one message. */
const secondaryModeFor = (
  turnActive: boolean,
  primaryMode: AgentMessageSubmitMode,
): AgentMessageSubmitMode | null => {
  if (!turnActive) return null;
  return primaryMode === "steer" ? "default" : "steer";
};

/**
 * The send state of the session composer: the draft, the composer policy, the prompt input
 * catalogs, the Message Queue, the pending review comments, and the last failure. The draft
 * stays editable while the host is not connected; send follows the command gate.
 */
export function useSessionComposer({ onSent }: { onSent: () => void }) {
  const { target, interaction } = useSessionScreen();
  const gate = useCommandGate();
  const operations = useAgentOperationsContext();
  const { allRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const facts = useSessionFacts();
  const composerFacts = useSessionSelector(target.identity, selectComposerFacts);
  const runtimeInfo = useSessionRuntimeInfo();
  const settings = useAgentStudioChatSettings({ workspaceRepoPath: target.repoPath });
  const { identity, owner } = target;
  const archived = owner.kind === "chat" && owner.record.archivedAt !== null;
  // An archived chat is read-only too.
  const readOnly = target.readOnly || archived;
  const descriptor =
    allRuntimeDefinitions.find((definition) => definition.kind === identity.runtimeKind) ?? null;
  const promptInput = useSessionPromptInput({
    repoPath: target.repoPath,
    runtimeKind: identity.runtimeKind,
    workingDirectory:
      owner.kind === "chat"
        ? owner.record.executionTarget.workingDirectory
        : identity.workingDirectory,
    identity,
    runtimeReadinessState: interaction.runtimeReadiness.state,
    reusablePrompts: settings.reusablePrompts,
  });
  const modelCatalog = runtimeInfo.modelCatalog;
  const selectedModelDescriptor = useMemo(
    () => findModelEntry(modelCatalog, facts.selectedModel),
    [facts.selectedModel, modelCatalog],
  );
  const runningTurnMessages = useMemo(
    () => (composerFacts.runningTurnMessage ? [composerFacts.runningTurnMessage] : EMPTY_MESSAGES),
    [composerFacts.runningTurnMessage],
  );

  const { draftScope, draftState } = useComposerDraft(target);

  const [failure, setFailure] = useState<ComposerFailure | null>(null);
  const activity = useAsyncActivityTracker();
  const canInteract =
    interaction.canInteract && !runtimeInfo.isLoadingModelCatalog && !target.readOnly;
  const draftKey = draftScope.key;
  const sendTarget = useMemo(
    (): AgentChatSendTarget => ({
      activity,
      activityKey: target.sessionKey,
      canSend: () => canInteract,
      // The composer belongs to one session, and `resolve` binds it. A send that the user leaves
      // during its attachment upload still reaches that session, so the recipient never changes.
      capture: () => () => true,
      resolve: async () => ({
        identity,
        sendOptions: {
          assertCanSubmit: (session) => {
            if (!matchesAgentSessionIdentity(session, identity)) throw new Error(RECIPIENT_CHANGED);
          },
        },
      }),
      // The draft comes back, and the submit reports the failure in the notice above the composer.
      onFailure: (cause) => ({
        kind: "recover_draft",
        originKey: draftKey,
        recoveryKey: draftKey,
        error: cause,
      }),
    }),
    [activity, canInteract, draftKey, identity, target.sessionKey],
  );
  const delivery = useAgentChatSend({
    identity,
    repoPath: target.repoPath,
    runtimeDescriptor: descriptor,
    modelCatalog,
    messages: runningTurnMessages,
    isSessionWorking: facts.isWorking,
    foregroundTurnActive: facts.foregroundTurnActive,
    isWaitingInput: facts.isWaitingInput,
    selectedModelDescriptor,
    draftRules: {
      reusablePrompts: settings.reusablePrompts,
      supportsAttachments: promptInput.support.supportsAttachments,
    },
    sendAgentMessage: operations.sendAgentMessage,
    target: sendTarget,
  });
  const inlineCommentOwner = useMemo(() => inlineCommentOwnerOf(target), [target]);
  const reviewComments = useReviewCommentComposer({
    owner: inlineCommentOwner,
    onSend: delivery.onSend,
    visibility: draftFlushVisibility,
  });
  const reviewOnSend = reviewComments.onSend;
  const sendDraft = useCallback(
    (draft: AgentChatComposerDraft, mode: AgentMessageSubmitMode) => {
      setFailure(null);
      return reviewOnSend(draft, mode);
    },
    [reviewOnSend],
  );

  const settingsReady = settings.chatSettings !== null;
  const primaryMode: AgentMessageSubmitMode = settings.chatSettings?.steerMessagesByDefault
    ? "steer"
    : "default";
  const policyModel: ComposerPolicyModel = {
    selectedModelDescriptor,
    runningTurnModel: delivery.runningTurnModel,
    isSessionWorking: facts.isWorking,
    foregroundTurnActive: facts.foregroundTurnActive,
    isSending: delivery.isSending,
    isStarting: interaction.isPreparing,
    // The catalog read closes send, not typing, so a draft stays editable while it loads.
    isModelSelectionPending: false,
    isInteractionEnabled: !readOnly,
    isReadOnly: readOnly,
    canSend: delivery.canSend,
    isWaitingInput: facts.isWaitingInput,
    isResumingSession: false,
    speed: null,
    pendingSendItems: reviewComments.pendingSendItems
      ? [reviewComments.pendingSendItems]
      : undefined,
    supportsAttachments: promptInput.support.supportsAttachments,
    steerBlockedReason: delivery.steerBlockedReason,
    supportsFileSearch: promptInput.support.supportsFileSearch,
    supportsSubagentReferences: promptInput.support.supportsSubagentReferences,
    // Reusable prompts of the host settings are slash commands too, as on desktop.
    supportsSlashCommands: promptInput.slashCommands.supportsSlashCommands,
    supportsSkillReferences: promptInput.support.supportsSkillReferences,
    readOnlyReason: archived ? "This chat is archived. Restore it to send messages." : null,
    waitingInputPlaceholder: composerFacts.waitingInputPlaceholder,
    messageQueue: delivery.messageQueue,
  };
  const policy = useComposerPolicy({
    model: policyModel,
    draft: draftState.draft,
    primaryMode,
    settingsReady,
    steerShortcutLabel: null,
  });
  // A pending request, an archived chat, or a settings read shows in the placeholder.
  const fieldText = composerFieldText({
    placeholder: policy.placeholder,
    hints: policy.placeholderHints,
  });

  const editor = useComposerDraftEditor({
    draft: draftState.draft,
    commitDraft: draftState.commitDraft,
  });
  const submit = useAgentChatComposerSubmit({
    model: {
      isSessionWorking: facts.isWorking,
      foregroundTurnActive: facts.foregroundTurnActive,
      onSend: sendDraft,
      draftScope,
      steerBlockedReason: delivery.steerBlockedReason,
      runningTurnModel: delivery.runningTurnModel,
    },
    draftState,
    draftRef: editor.draftRef,
    settingsReady,
    sendInputBlocked: policy.sendInputBlocked,
    defaultSendDisabled: policy.defaultSendDisabled,
    reportError: setFailure,
    // The editor keeps one input and moves its caret for a draft that it did not write itself.
    onDraftReplaced: noop,
    onSettledInScope: onSent,
  });

  return {
    target,
    gateOpen: gate.open,
    canInteract,
    settingsReady,
    blockedReason: interaction.blockedReason,
    draft: draftState.draft,
    editor,
    policy,
    fieldText,
    primaryMode,
    secondaryMode: secondaryModeFor(
      hasForegroundTurn({
        foregroundTurnActive: facts.foregroundTurnActive,
        isSessionWorking: facts.isWorking,
      }),
      primaryMode,
    ),
    submit,
    delivery,
    promptInput,
    reviewComments,
    /** The task or chat whose Changes hold the review comments of this composer. */
    commentOwner: inlineCommentOwner,
    selectedModelDescriptor,
    modelCatalog,
    selectedModel: facts.selectedModel,
    // As on desktop, a read-only or archived session and a send in progress keep the model fixed.
    // A running turn and pending input keep it open.
    modelOptionsDisabled: readOnly || delivery.isSending,
    isWorking: facts.isWorking,
    foregroundTurnActive: facts.foregroundTurnActive,
    isWaitingInput: facts.isWaitingInput,
    settingsLoadError: settings.chatSettingsLoadError,
    retrySettings: settings.retryChatSettingsLoad,
    failure,
    dismissFailure: () => setFailure(null),
  };
}

export type SessionComposerModel = ReturnType<typeof useSessionComposer>;
