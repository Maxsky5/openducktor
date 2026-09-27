import type { ReactElement, ReactNode } from "react";
import type { TerminalPanelModel } from "@/features/terminals";
import {
  TerminalSplitLayout,
  type TerminalSplitIds,
  useTerminalSplit,
} from "@/features/terminals/terminal-split-layout";

const ids: TerminalSplitIds = {
  group: "workspace-session-terminal-layout",
  content: "workspace-session-content-panel",
  terminal: "workspace-session-terminal-panel",
};

export function WorkspaceSessionTerminalLayout({
  children,
  model,
}: {
  children: ReactNode;
  model: TerminalPanelModel;
}): ReactElement {
  const layout = useTerminalSplit(ids, model.isVisible);
  return (
    <TerminalSplitLayout
      ids={ids}
      model={model}
      layout={layout}
      className="min-h-0 min-w-0 flex-1 overflow-hidden"
      contentClassName="flex h-full min-h-0 flex-col"
    >
      {children}
    </TerminalSplitLayout>
  );
}
