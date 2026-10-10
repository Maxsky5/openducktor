import { type RefObject, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  type TerminalCloseDialogModel,
  type TerminalSessionsModel,
  type TerminalTab,
  terminalTabLabel,
} from "@/features/terminals";
import { errorMessage } from "@/lib/errors";
import type { PanelId } from "./panel-tab-kinds";
import {
  type ResolvedPanelTab,
  type SessionPanelLayoutUpdate,
  selectPanelTab,
  selectPanelTabNeighbor,
} from "./session-panel-layout";

export type LatestPanelState = {
  ownerKey: string | null;
  terminals: TerminalSessionsModel;
  tabs: Record<PanelId, readonly ResolvedPanelTab[]>;
  selected: Record<PanelId, string | null>;
};

type CloseCandidate = { ownerKey: string; panel: PanelId; entryId: string; tab: TerminalTab };

type SessionPanelTerminalClose = {
  /** Closes a terminal tab. Resolves to true when the terminal closed. */
  closeTerminalTab: (
    panel: PanelId,
    entryId: string,
    tab: TerminalTab,
    confirmTerminate: boolean,
  ) => Promise<boolean>;
  terminalClose: TerminalCloseDialogModel;
};

/**
 * Closes a terminal tab. A terminal without a running command closes at once: its tab hides while
 * the host ends it. A terminal that runs a command asks for a confirmation first. A rejected or
 * failed close gives the tab back.
 */
export function useSessionPanelTerminalClose({
  ownerKey,
  latest,
  update,
  setBottomOpen,
}: {
  ownerKey: string | null;
  latest: RefObject<LatestPanelState>;
  update: SessionPanelLayoutUpdate;
  setBottomOpen: (value: boolean) => void;
}): SessionPanelTerminalClose {
  const [candidate, setCandidate] = useState<CloseCandidate | null>(null);
  const [confirmingOwnerKey, setConfirmingOwnerKey] = useState<string | null>(null);

  const closeTerminalTab = useCallback(
    async (
      panel: PanelId,
      entryId: string,
      tab: TerminalTab,
      confirmTerminate: boolean,
    ): Promise<boolean> => {
      const { ownerKey: startOwnerKey, terminals, selected } = latest.current;
      if (startOwnerKey === null) return false;
      // A terminal that runs a command needs a confirmation. The dialog opens at once, and the tab
      // and its panel stay as they are behind it.
      if (
        !confirmTerminate &&
        tab.terminalId !== null &&
        terminals.runningCommandTerminalIds.has(tab.terminalId)
      ) {
        setCandidate({ ownerKey: startOwnerKey, panel, entryId, tab });
        return false;
      }
      const isCurrentOwner = (): boolean => latest.current.ownerKey === startOwnerKey;
      const wasSelected = selected[panel] === entryId;
      // The tab hides while it closes. The controller hides an emptied bottom panel.
      update((current, context) => selectPanelTabNeighbor(current, context, panel, entryId));
      let closed = false;
      try {
        closed = (await terminals.onClose(tab, confirmTerminate)).closed;
        if (!closed && isCurrentOwner()) {
          setCandidate({ ownerKey: startOwnerKey, panel, entryId, tab });
        }
      } catch (cause) {
        toast.error(`Could not close ${terminalTabLabel(tab)}`, {
          description: errorMessage(cause),
        });
      }
      if (!closed && isCurrentOwner()) {
        if (wasSelected)
          update((current, context) => selectPanelTab(current, context, panel, entryId));
        if (panel === "bottom") setBottomOpen(true);
      }
      return closed;
    },
    [latest, setBottomOpen, update],
  );

  const visibleCandidate = candidate?.ownerKey === ownerKey ? candidate : null;
  const isConfirming =
    visibleCandidate !== null && confirmingOwnerKey === visibleCandidate.ownerKey;
  const onConfirm = useCallback((): void => {
    if (!visibleCandidate) return;
    setConfirmingOwnerKey(visibleCandidate.ownerKey);
    void closeTerminalTab(
      visibleCandidate.panel,
      visibleCandidate.entryId,
      visibleCandidate.tab,
      true,
    ).then((closed) => {
      setConfirmingOwnerKey((current) => (current === visibleCandidate.ownerKey ? null : current));
      if (closed) setCandidate((current) => (current === visibleCandidate ? null : current));
    });
  }, [closeTerminalTab, visibleCandidate]);
  const onCancel = useCallback((): void => setCandidate(null), []);
  const candidateTab = visibleCandidate?.tab ?? null;
  const terminalClose = useMemo(
    () => ({ candidate: candidateTab, isConfirming, onConfirm, onCancel }),
    [candidateTab, isConfirming, onCancel, onConfirm],
  );

  return { closeTerminalTab, terminalClose };
}
