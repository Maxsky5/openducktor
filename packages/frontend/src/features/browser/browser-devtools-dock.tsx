import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { type ReactElement, useLayoutEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { browserDevToolsUrlQueryOptions } from "@/state/queries/browser";
import { useBrowserDevToolsStore } from "./browser-devtools-store";
import { devToolsSurfaceKey } from "./browser-surface-registry";
import { useBrowserSlot } from "./use-browser-tab-page";

/** The size of the docked DevTools of a tab in percent, or undefined while they do not show. */
export const useDevToolsSize = (tabId: string, supported: boolean): number | undefined => {
  const dock = useBrowserDevToolsStore((state) => state.docks[tabId]);
  return supported && dock?.open ? dock.size : undefined;
};

/**
 * The page slot, and the docked DevTools when they show. DevTools dock to the right in a wide
 * area, such as the bottom panel, and to the bottom in a tall one, such as the right panel.
 */
export function BrowserPageArea({
  tabId,
  page,
  devToolsSize,
  showsDevTools,
}: {
  tabId: string;
  page: ReactElement;
  /** The DevTools size in percent, or undefined while DevTools are closed. */
  devToolsSize: number | undefined;
  showsDevTools: boolean;
}): ReactElement {
  const [area, setArea] = useState<HTMLElement | null>(null);
  const wide = useWideArea(area);
  const pageId = `${tabId}:page`;
  const devToolsId = `${tabId}:devtools`;
  return (
    <div ref={setArea} className="relative min-h-0 flex-1">
      {devToolsSize === undefined ? (
        page
      ) : (
        <ResizablePanelGroup
          key={wide ? "row" : "column"}
          orientation={wide ? "horizontal" : "vertical"}
          onLayoutChanged={(layout) => {
            const size = layout[devToolsId];
            if (size !== undefined) useBrowserDevToolsStore.getState().resize(tabId, size);
          }}
        >
          <ResizablePanel id={pageId} defaultSize={`${100 - devToolsSize}%`} minSize="20%">
            {page}
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize DevTools"
            className="w-1.5 aria-[orientation=horizontal]:h-1.5"
          />
          <ResizablePanel id={devToolsId} defaultSize={`${devToolsSize}%`} minSize="15%">
            <BrowserDevToolsSlot tabId={tabId} visible={showsDevTools} />
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}

/**
 * The docked DevTools of a tab: a header with Close, and the slot where the browser layer places
 * the DevTools frontend. The frontend runs without the Chrome window that gives it a Close button.
 */
function BrowserDevToolsSlot({ tabId, visible }: { tabId: string; visible: boolean }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const url = useQuery(browserDevToolsUrlQueryOptions(tabId));
  const key = devToolsSurfaceKey(tabId);
  useBrowserSlot(key, slot, visible && url.data !== undefined);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-7 shrink-0 items-center justify-between border-b border-border pl-2.5 pr-1">
        <span className="text-xs font-medium text-muted-foreground">DevTools</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-muted-foreground"
          aria-label="Close DevTools"
          title="Close DevTools"
          onClick={() => useBrowserDevToolsStore.getState().close(tabId)}
        >
          <X className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div
        ref={setSlot}
        className="relative min-h-0 flex-1 overflow-hidden"
        data-browser-slot={key}
      >
        {url.error ? (
          <p
            role="alert"
            className="flex h-full items-center justify-center p-4 text-sm text-destructive"
          >
            Could not open DevTools: {errorMessage(url.error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Follows the shape of an element. It turns wide above 1.4 times its height and tall again below
 * 1.1, so a size near the limit does not switch the DevTools side back and forth.
 */
const useWideArea = (element: HTMLElement | null): boolean => {
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    if (element === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setWide((current) => (current ? width > height * 1.1 : width > height * 1.4));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return wide;
};
