import type { AgentModelSelection, RuntimeWorkingDirectoryRef } from "@openducktor/core";
import { useCallback } from "react";
import { useSessionStartContext } from "@/features/session-start/use-session-start-context";
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
 * Check the returned guard before transport to catch a target change.
 */
export function useSessionModelPreparation(
  targetKey: string,
  selections: ChatComposerModelSelections,
  hasSessionTarget: boolean,
): PrepareModelForSend {
  const isCurrentTarget = useSessionStartContext(targetKey);
  const assertCurrent = useCallback(() => {
    if (!isCurrentTarget()) {
      throw new Error("The model target changed. Reopen the original chat to send your draft.");
    }
  }, [isCurrentTarget]);
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
        throw new Error(
          sendBlockReason === "profile"
            ? "The saved Runtime Profile is unavailable or cannot change in this chat. Refresh the catalog and select a Runtime Profile, or start a new chat."
            : "No valid model is available for this chat. Refresh the catalog and select a model before sending.",
        );
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
