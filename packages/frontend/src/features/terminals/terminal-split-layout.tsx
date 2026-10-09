import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TerminalPanel } from "./terminal-panel";
import type { TerminalPanelModel } from "./use-terminals";

export type TerminalSplitIds = {
  group: string;
  content: string;
  terminal: string;
  separator?: string;
};

type TerminalSplitState = {
  isNarrow: boolean;
  groupRef: RefObject<GroupImperativeHandle | null>;
  onLayoutChanged(layout: Record<string, number>): void;
};

type TerminalSplitLayoutProps = {
  ids: TerminalSplitIds;
  model: TerminalPanelModel;
  layout: TerminalSplitState;
  className: string;
  contentClassName: string;
  children: ReactNode;
};

export function useTerminalSplit(ids: TerminalSplitIds, isVisible: boolean): TerminalSplitState {
  const [isNarrow, setIsNarrow] = useState(false);
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const terminalSizeRef = useRef(28);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const updateNarrow = () => setIsNarrow(media.matches);
    updateNarrow();
    media.addEventListener("change", updateNarrow);
    return () => media.removeEventListener("change", updateNarrow);
  }, []);
  useLayoutEffect(() => {
    let terminalSize = 0;
    if (isVisible) {
      terminalSize = isNarrow ? 100 : terminalSizeRef.current;
    }
    groupRef.current?.setLayout({
      [ids.content]: 100 - terminalSize,
      [ids.terminal]: terminalSize,
    });
  }, [ids.content, ids.terminal, isNarrow, isVisible]);
  const onLayoutChanged = useCallback(
    (layout: Record<string, number>): void => {
      const size = layout[ids.terminal];
      if (!isNarrow && size !== undefined && size > 0) terminalSizeRef.current = size;
    },
    [ids.terminal, isNarrow],
  );
  return { isNarrow, groupRef, onLayoutChanged };
}

export function TerminalSplitLayout({
  ids,
  model,
  layout,
  className,
  contentClassName,
  children,
}: TerminalSplitLayoutProps): ReactElement {
  const { isNarrow, groupRef, onLayoutChanged } = layout;
  return (
    <ResizablePanelGroup
      id={ids.group}
      defaultLayout={{
        [ids.content]: model.isVisible ? 72 : 100,
        [ids.terminal]: model.isVisible ? 28 : 0,
      }}
      groupRef={groupRef}
      onLayoutChanged={onLayoutChanged}
      direction="vertical"
      className={className}
    >
      <ResizablePanel id={ids.content} defaultSize="72%" minSize={isNarrow ? "0%" : "30%"}>
        <div className={contentClassName} hidden={isNarrow && model.isVisible}>
          {children}
        </div>
      </ResizablePanel>
      {!isNarrow && model.isVisible ? (
        <ResizableHandle id={ids.separator} aria-label="Resize terminal panel" withHandle />
      ) : null}
      <ResizablePanel
        id={ids.terminal}
        collapsible
        collapsedSize="0%"
        defaultSize="28%"
        minSize={isNarrow ? "0%" : "16%"}
        maxSize={isNarrow ? "100%" : "70%"}
      >
        <div className="h-full min-h-0" hidden={!model.isVisible}>
          <TerminalPanel
            model={model}
            headerLeading={
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="shrink-0 text-(--terminal-foreground) hover:bg-(--terminal-tab-inactive) hover:text-(--terminal-foreground) md:hidden"
                onClick={model.onHide}
              >
                Back to workspace
              </Button>
            }
          />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
