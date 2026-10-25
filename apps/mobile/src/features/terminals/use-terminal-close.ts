import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type TerminalTab,
  terminalTabLabel,
} from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import { useCallback, useMemo, useState } from "react";
import { type Confirm, useConfirm } from "@/ui/confirm-dialog";
import { closeTerminalTab } from "./terminal-close";

/** Asks before a close stops a running process tree. The texts match the desktop dialog. */
const confirmTerminalTerminate = (confirm: Confirm, label: string): Promise<boolean> =>
  confirm({
    title: `Terminate and close ${label}?`,
    message: "This stops the running process tree. This action cannot be undone.",
    confirmLabel: "Terminate and close",
    destructive: true,
  });

/**
 * The close action of the Terminals views. It keeps the lost close results by tab, so each row
 * can show "Result unknown" with the host guidance.
 */
export const useTerminalClose = (
  model: TerminalSessionsModel,
  onClosed?: (tab: TerminalTab) => void,
) => {
  const { feedback } = useClientConnection();
  const confirm = useConfirm();
  const [unknownByTabId, setUnknownByTabId] = useState<ReadonlyMap<string, string>>(new Map());
  const close = useCallback(
    async (tab: TerminalTab): Promise<void> => {
      const outcome = await closeTerminalTab(model, tab, (label) =>
        confirmTerminalTerminate(confirm, label),
      );
      setUnknownByTabId((current) => {
        if (!current.has(tab.tabId) && outcome.kind !== "unknown") return current;
        const next = new Map(current);
        if (outcome.kind === "unknown") next.set(tab.tabId, outcome.guidance);
        else next.delete(tab.tabId);
        return next;
      });
      if (outcome.kind === "closed") onClosed?.(tab);
      if (outcome.kind === "unknown") model.onRetryDiscovery();
      if (outcome.kind === "failed") {
        feedback.show("error", `Could not close ${terminalTabLabel(tab)}`, {
          description: outcome.message,
        });
      }
    },
    [confirm, feedback, model, onClosed],
  );
  // A lost result no longer matters once its tab leaves the list.
  const tabIds = useMemo(() => new Set(model.tabs.map((tab) => tab.tabId)), [model.tabs]);
  const closeUnknown = useMemo(
    () => new Map([...unknownByTabId].filter(([tabId]) => tabIds.has(tabId))),
    [tabIds, unknownByTabId],
  );
  return { close, closeUnknown };
};
