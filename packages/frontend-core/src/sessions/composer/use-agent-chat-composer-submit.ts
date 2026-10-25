import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { type RefObject, useCallback, useLayoutEffect, useRef } from "react";
import {
  type AgentChatComposerDraft,
  createEmptyComposerDraft,
} from "../../drafts/agent-chat-composer-draft";
import {
  draftSteerBlockedReason,
  hasForegroundTurn,
  steersRunningTurn,
} from "../send/agent-chat-steering";
import type { AgentChatSend } from "../send/agent-chat.types";
import { type ComposerFailure, describeComposerFailure } from "./composer-failure";
import type { useAgentChatComposerDraftState } from "./use-agent-chat-composer-draft-state";

/** The chat state that one submit reads when it starts. */
export type ComposerSubmitModel = {
  isSessionWorking: boolean;
  /** True while the session runs a turn in the foreground. */
  foregroundTurnActive?: boolean | undefined;
  onSend: AgentChatSend["onSend"];
  draftScope: { key: string };
  steerBlockedReason: string | null;
  runningTurnModel: AgentModelCatalog["models"][number] | null;
};

type DraftState = Pick<
  ReturnType<typeof useAgentChatComposerDraftState>,
  | "createSubmittedDraftSnapshot"
  | "clearSubmittedDraft"
  | "restoreSubmittedDraft"
  | "setDisplayedDraft"
>;

type UseAgentChatComposerSubmitArgs = {
  model: ComposerSubmitModel;
  draftState: DraftState;
  /** The latest draft, which the composer updates on each edit before it renders. */
  draftRef: RefObject<AgentChatComposerDraft>;
  settingsReady: boolean;
  /** The composer policy flags. A steer checks `sendInputBlocked`, a default send the other. */
  sendInputBlocked: boolean;
  defaultSendDisabled: boolean;
  /** Shows a failure of the user's send. Each client shows it in its own way. */
  reportError: (failure: ComposerFailure) => void;
  /** Runs after the composer clears the draft and when it restores a failed draft. */
  onDraftReplaced: () => void;
  /** Runs when the send ends while the composer still shows the same chat. */
  onSettledInScope: () => void;
};

/**
 * Sends the composer draft. The composer shows an empty draft at once. A failed send restores the
 * draft, unless the user typed a newer one, and reports the failure.
 */
export function useAgentChatComposerSubmit({
  model,
  draftState,
  draftRef,
  settingsReady,
  sendInputBlocked,
  defaultSendDisabled,
  reportError,
  onDraftReplaced,
  onSettledInScope,
}: UseAgentChatComposerSubmitArgs): (mode: AgentMessageSubmitMode) => Promise<void> {
  const modelRef = useRef(model);
  const settingsReadyRef = useRef(settingsReady);
  const sendInputBlockedRef = useRef(sendInputBlocked);
  const defaultSendDisabledRef = useRef(defaultSendDisabled);
  // A second tap can come before the composer renders the cleared draft, so it reads the same
  // draft again. A draft that a running send took is not sent a second time.
  const sendingDraftRef = useRef<AgentChatComposerDraft | null>(null);
  useLayoutEffect(() => {
    modelRef.current = model;
    settingsReadyRef.current = settingsReady;
    sendInputBlockedRef.current = sendInputBlocked;
    defaultSendDisabledRef.current = defaultSendDisabled;
  }, [defaultSendDisabled, model, sendInputBlocked, settingsReady]);
  const {
    createSubmittedDraftSnapshot,
    clearSubmittedDraft,
    restoreSubmittedDraft,
    setDisplayedDraft,
  } = draftState;

  return useCallback(
    async (mode: AgentMessageSubmitMode): Promise<void> => {
      if (!settingsReadyRef.current) return;
      const steersTurn = steersRunningTurn(mode, hasForegroundTurn(modelRef.current));
      if (steersTurn ? sendInputBlockedRef.current : defaultSendDisabledRef.current) {
        return;
      }
      const submitDraft = modelRef.current.onSend;
      const submittedDraft = draftRef.current;
      if (submittedDraft === sendingDraftRef.current) return;
      const steerBlockedReason = steersTurn
        ? draftSteerBlockedReason(submittedDraft, modelRef.current)
        : null;
      if (steerBlockedReason) {
        reportError({
          kind: "failed",
          title: "Cannot steer this message",
          message: steerBlockedReason,
        });
        return;
      }
      sendingDraftRef.current = submittedDraft;
      const submittedSnapshot = createSubmittedDraftSnapshot(submittedDraft);
      clearSubmittedDraft(submittedSnapshot);
      setDisplayedDraft(createEmptyComposerDraft());
      onDraftReplaced();
      onSettledInScope();
      const isSameScope = (): boolean => modelRef.current.draftScope.key === submittedSnapshot.key;
      const reportSendFailure = (error: Error) => {
        reportError(
          describeComposerFailure(error, {
            title: "Unable to send message",
            attachmentNames: (submittedDraft.attachments ?? []).map(
              (attachment) => attachment.name,
            ),
          }),
        );
      };
      try {
        const result = await submitDraft(submittedDraft, mode);
        if (result !== true && result !== false) {
          restoreSubmittedDraft(submittedSnapshot, result);
          reportSendFailure(result.error);
          return;
        }
        if (!result) {
          restoreSubmittedDraft(submittedSnapshot);
          if (isSameScope()) {
            onDraftReplaced();
            onSettledInScope();
          }
          return;
        }
        if (isSameScope()) onSettledInScope();
      } catch (error) {
        reportSendFailure(error instanceof Error ? error : new Error(String(error)));
        restoreSubmittedDraft(submittedSnapshot);
        if (isSameScope()) {
          onDraftReplaced();
          onSettledInScope();
        }
      } finally {
        // A failed send restores this draft, and the user can send it again.
        if (sendingDraftRef.current === submittedDraft) sendingDraftRef.current = null;
      }
    },
    [
      clearSubmittedDraft,
      createSubmittedDraftSnapshot,
      draftRef,
      onDraftReplaced,
      onSettledInScope,
      reportError,
      restoreSubmittedDraft,
      setDisplayedDraft,
    ],
  );
}
