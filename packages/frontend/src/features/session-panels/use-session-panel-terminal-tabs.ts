import { type RefObject, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import type { TerminalCloseDialogModel } from "@/features/terminals";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import { terminalCloseNeedsConfirmation } from "@openducktor/frontend-core/terminals/terminal-tab-presentation";
import {
  type TerminalTab,
  terminalTabLabel,
} from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { PanelId } from "./panel-tab-kinds";
import {
  type HostTabActions,
  pickPanelTabKind,
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

type SessionPanelTerminalTabs = {
  actions: HostTabActions<"terminal">;
  terminalClose: TerminalCloseDialogModel;
};

/**
 * Opens and closes terminal tabs. A new terminal takes the keyboard focus. A terminal without a
 * running command closes at once: its tab hides while the host ends it. A terminal that runs a
 * command asks for a confirmation first. A rejected or failed close gives the tab back.
 */
export function useSessionPanelTerminalTabs({
  ownerKey,
  latest,
  update,
  setBottomOpen,
  requestFocus,
}: {
  ownerKey: string | null;
  latest: RefObject<LatestPanelState>;
  update: SessionPanelLayoutUpdate;
  setBottomOpen: (value: boolean) => void;
  requestFocus: (panel: PanelId) => void;
}): SessionPanelTerminalTabs {
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
        terminalCloseNeedsConfirmation(tab, terminals.runningCommandTerminalIds)
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

  const actions = useMemo<HostTabActions<"terminal">>(
    () => ({
      pick: (panel) => {
        const { terminals, ownerKey: currentOwnerKey } = latest.current;
        if (terminals.scopeKey !== currentOwnerKey) return;
        const tabId = terminals.createTerminal();
        if (tabId === null) return;
        update((current, context) =>
          pickPanelTabKind(current, context, panel, { kind: "terminal", tabId }),
        );
        requestFocus(panel);
      },
      close: (panel, tab) => void closeTerminalTab(panel, tab.id, tab.terminal, false),
    }),
    [closeTerminalTab, latest, requestFocus, update],
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

  return { actions, terminalClose };
}
