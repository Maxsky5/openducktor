import { SquareTerminal, Wrench } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ToolCallPanelTabContent,
  useShownToolCallTab,
} from "@/components/features/agents/agent-chat/agent-chat-tool-details-panel";
import {
  createToolDetailsStore,
  type ToolDetailsStore,
  ToolDetailsStoreContext,
} from "@/components/features/agents/agent-chat/agent-chat-tool-details-store";
import { SessionPanelViewTabsContext, type ToolTabView } from "./session-panel";

/** The tool details of a page, and what its session panels need to show the tool call tab. */
export type PageToolDetails = {
  store: ToolDetailsStore;
  view: ToolTabView | null;
  toolCallTab: { revealRevision: number; onClose: () => void } | null;
};

/**
 * The tool details of a page that shows calls in its right panel. A call of a transcript that the
 * page no longer shows, such as the session of another task, closes.
 */
export const usePageToolDetails = (shownSessionKey: string | null): PageToolDetails => {
  const [store] = useState(createToolDetailsStore);
  const { revealRevision, title, isShell, close } = useShownToolCallTab(store);
  useEffect(() => {
    store.close();
  }, [shownSessionKey, store]);
  const toolCallTab = useMemo(
    () => (revealRevision === null ? null : { revealRevision, onClose: close }),
    [close, revealRevision],
  );
  const isOpen = revealRevision !== null;
  const view = useMemo<ToolTabView | null>(
    () =>
      isOpen
        ? {
            label: title ?? "Tool call",
            icon: isShell === false ? Wrench : SquareTerminal,
            content: <ToolCallPanelTabContent store={store} />,
          }
        : null,
    [isOpen, isShell, store, title],
  );
  return { store, view, toolCallTab };
};

/** Gives the tool details of the page to its transcripts and to its right panel. */
export function PageToolDetailsProvider({
  details,
  children,
}: {
  details: PageToolDetails;
  children: ReactNode;
}): ReactElement {
  const { view, store } = details;
  const viewTabs = useMemo(() => (view ? { tool_call: view } : null), [view]);
  return (
    <ToolDetailsStoreContext value={store}>
      <SessionPanelViewTabsContext value={viewTabs}>{children}</SessionPanelViewTabsContext>
    </ToolDetailsStoreContext>
  );
}
