import { createGitConflictActionsModel } from "@/features/git-conflict-resolution";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentStudioGitPanelModel } from "./types";

export type GitPanelConflict = ReturnType<typeof useGitConflictPanel>;

export function useGitConflictPanel(model: AgentStudioGitPanelModel) {
  const {
    abortGitConflict,
    askBuilderToResolveGitConflict: askForHelp,
    gitConflict,
    gitConflictAction,
    gitConflictAutoOpenNonce,
    gitConflictCloseNonce,
    isHandlingGitConflict,
  } = model;
  const active = gitConflict ?? null;
  const hasConflict = active != null;
  const [isModalOpen, setModalOpen] = useState(false);
  const initializedRef = useRef(false);
  const previousAutoOpenNonceRef = useRef(0);
  const previousCloseNonceRef = useRef(0);
  const autoOpenNonce = gitConflictAutoOpenNonce ?? 0;
  const closeNonce = gitConflictCloseNonce ?? 0;
  const closeAndAsk = useCallback((): void => {
    setModalOpen(false);
    void askForHelp?.();
  }, [askForHelp]);
  const { stripActions, modalActions } = useMemo(() => {
    if (!active) return { stripActions: null, modalActions: null };
    const options = {
      operation: active.operation,
      recipientLabel: model.conflictRecipientLabel,
      blockedReason: model.conflictAssistanceBlockedReason,
      isStarting: model.conflictAssistanceIsStarting,
      isHandlingConflict: isHandlingGitConflict ?? false,
      conflictAction: gitConflictAction,
      onAbort: () => void abortGitConflict?.(),
      onAsk: askForHelp ? () => void askForHelp() : undefined,
    };
    return {
      stripActions: createGitConflictActionsModel(options),
      modalActions: createGitConflictActionsModel({
        ...options,
        onAsk: askForHelp ? closeAndAsk : undefined,
      }),
    };
  }, [
    active,
    abortGitConflict,
    askForHelp,
    closeAndAsk,
    gitConflictAction,
    isHandlingGitConflict,
    model.conflictRecipientLabel,
    model.conflictAssistanceBlockedReason,
    model.conflictAssistanceIsStarting,
  ]);

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      previousAutoOpenNonceRef.current = autoOpenNonce;
      previousCloseNonceRef.current = closeNonce;
      return;
    }
    let nextOpen: boolean | null = null;
    if (closeNonce !== previousCloseNonceRef.current) {
      previousCloseNonceRef.current = closeNonce;
      nextOpen = false;
    }
    if (autoOpenNonce !== previousAutoOpenNonceRef.current) {
      previousAutoOpenNonceRef.current = autoOpenNonce;
      nextOpen = true;
    }
    if (!hasConflict) {
      nextOpen = false;
    }
    if (nextOpen !== null) {
      setModalOpen(nextOpen);
    }
  }, [autoOpenNonce, closeNonce, hasConflict]);

  return { active, hasConflict, isModalOpen, modalActions, setModalOpen, stripActions };
}
