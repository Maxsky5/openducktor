import type { AgentModelSelection, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import type { ChatComposerModelSelections } from "./model-selection-preferences";

export type UpdateSessionModel = (
  session: AgentSessionIdentity,
  selection: AgentModelSelection | null,
) => Promise<void> | void;

export type PrepareModelForSend = (update: UpdateSessionModel) => Promise<() => void>;

/**
 * The caller must track Send activity because model writes can resume an idle session.
 * Scope adapters check owner lifetime. Activity can hide a pane without changing its target.
 * Check the returned guard before transport to catch a target change.
 */
export function useSessionModelPreparation(
  targetKey: string,
  selections: ChatComposerModelSelections,
  hasSessionTarget: boolean,
): PrepareModelForSend {
  const target = useMemo(() => ({ key: targetKey }), [targetKey]);
  const currentTarget = useRef(target);
  useLayoutEffect(() => {
    currentTarget.current = target;
  }, [target]);
  const assertCurrent = useCallback(() => {
    if (currentTarget.current !== target) {
      throw new Error("The model target changed. Reopen the original chat to send your draft.");
    }
  }, [target]);
  return useCallback<PrepareModelForSend>(
    async (update) => {
      assertCurrent();
      if (hasSessionTarget && selections.selectedModelSelection && !selections.selectionCatalog) {
        throw new Error(
          "The session model catalog is unavailable. Open the model picker and retry the catalog before sending.",
        );
      }
      const { repair, sendBlockReason } = selections;
      if (repair) {
        await update(repair.session, repair.selection);
      } else if (sendBlockReason) {
        const messages = {
          model:
            "No valid model is available for this chat. Refresh the catalog and select a model before sending.",
          profile:
            "The saved Runtime Profile is unavailable or cannot change in this chat. Refresh the catalog and select a Runtime Profile, or start a new chat.",
          session: "The session is still loading. Wait for it to load, then send your draft.",
        };
        throw new Error(messages[sendBlockReason]);
      }
      assertCurrent();
      return assertCurrent;
    },
    [assertCurrent, hasSessionTarget, selections],
  );
}

export function sessionModelPreparationKey(
  repoPath: string | null,
  identity: AgentSessionIdentity | null,
  catalogTarget?: RuntimeWorkingDirectoryRef,
): string {
  return JSON.stringify([
    repoPath,
    identity ? agentSessionIdentityKey(identity) : null,
    catalogTarget?.repoPath,
    catalogTarget?.runtimeKind,
    catalogTarget?.workingDirectory,
  ]);
}
