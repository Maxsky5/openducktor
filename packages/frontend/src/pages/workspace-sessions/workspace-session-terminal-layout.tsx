import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { GroupImperativeHandle } from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TerminalPanel, type TerminalPanelModel } from "@/features/terminals";

const CONTENT_ID = "workspace-session-content-panel";
const TERMINAL_ID = "workspace-session-terminal-panel";

export function WorkspaceSessionTerminalLayout({
  children,
  model,
}: {
  children: ReactNode;
  model: TerminalPanelModel;
}): ReactElement {
  const [isNarrow, setIsNarrow] = useState(false);
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const terminalSizeRef = useRef(28);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsNarrow(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  useLayoutEffect(() => {
    const terminalSize = model.isVisible ? (isNarrow ? 100 : terminalSizeRef.current) : 0;
    groupRef.current?.setLayout({
      [CONTENT_ID]: 100 - terminalSize,
      [TERMINAL_ID]: terminalSize,
    });
  }, [isNarrow, model.isVisible]);
  const onLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      const size = layout[TERMINAL_ID];
      if (!isNarrow && size !== undefined && size > 0) terminalSizeRef.current = size;
    },
    [isNarrow],
  );
  return (
    <ResizablePanelGroup
      id="workspace-session-terminal-layout"
      defaultLayout={{
        [CONTENT_ID]: model.isVisible ? 72 : 100,
        [TERMINAL_ID]: model.isVisible ? 28 : 0,
      }}
      groupRef={groupRef}
      onLayoutChanged={onLayoutChanged}
      direction="vertical"
      className="min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <ResizablePanel id={CONTENT_ID} defaultSize="72%" minSize={isNarrow ? "0%" : "30%"}>
        <div className="flex h-full min-h-0 flex-col" hidden={isNarrow && model.isVisible}>
          {children}
        </div>
      </ResizablePanel>
      {!isNarrow && model.isVisible ? (
        <ResizableHandle aria-label="Resize terminal panel" withHandle />
      ) : null}
      <ResizablePanel
        id={TERMINAL_ID}
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
                className="md:hidden"
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
