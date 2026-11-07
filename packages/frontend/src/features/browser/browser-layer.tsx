import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { browserDevToolsUrlQueryOptions } from "@/state/queries/browser";
import { useBrowserDevToolsStore } from "./browser-devtools-store";
import {
  type ElectronBrowserRuntime,
  type FrameBrowserRuntime,
  useBrowserRuntime,
  useBrowserTabs,
} from "./browser-runtime";
import type { BrowserSlot, BrowserSurfaceRegistry } from "./browser-surface-registry";
import { browserSurfaceKey, devToolsSurfaceKey } from "./browser-surface-registry";
import { ElectronPageSurface } from "./electron-page-surface";
import { FrameBrowserSurface } from "./frame-surface";
import { useBrowserSurfacePlacement } from "./use-browser-surface-placement";
import {
  NO_PAGE_OCCLUDERS,
  type PageOccluderBox,
  pageIsOccluded,
  usePageOccluders,
} from "./use-page-occluders";
import { DevToolsWebviewSurface } from "./devtools-webview-surface";

/**
 * The page surfaces of all browser tabs, mounted once in the app shell. Panels render only slots,
 * and this layer places each surface over its slot. A page thus survives panel moves, owner
 * switches, and route changes: Electron keeps the native view of each started tab alive, and the
 * web runner keeps the iframe of each user tab mounted.
 */
export function BrowserLayer() {
  const runtime = useBrowserRuntime();
  return (
    <div className="pointer-events-none fixed inset-0 z-10" data-testid="browser-layer">
      {runtime.surface === "electron" ? (
        <ElectronSurfaces runtime={runtime} />
      ) : (
        <FrameSurfaces runtime={runtime} />
      )}
    </div>
  );
}

/** The native page view of each started panel tab, and the docked DevTools that show. */
function ElectronSurfaces({ runtime }: { runtime: ElectronBrowserRuntime }) {
  const { tabs } = useBrowserTabs();
  const { bridge, focus, overlays, slots } = runtime;
  const occluders = usePageOccluders();
  const devToolsDocks = useBrowserDevToolsStore((state) => state.docks);
  const devToolsTabIds = Object.keys(devToolsDocks).filter(
    (tabId) => devToolsDocks[tabId]?.open && tabs.get(tabId)?.live,
  );
  return (
    <>
      {Array.from(tabs.values()).map((tab) => {
        // A saved tab has no page until the panels start it.
        if (tab.surface !== "panel" || !tab.started) return null;
        const key = browserSurfaceKey(tab.tabId);
        return (
          <SurfaceFrame
            key={key}
            slots={slots}
            overlaps={overlays}
            surfaceKey={key}
            occluders={occluders}
          >
            {(placement, occluded) => (
              <ElectronPageSurface
                bridge={bridge}
                focus={focus}
                occluded={occluded}
                placement={placement}
                tabId={tab.tabId}
              />
            )}
          </SurfaceFrame>
        );
      })}
      {devToolsTabIds.map((tabId) => (
        <DevToolsSurface key={tabId} slots={slots} browserTabId={tabId} />
      ))}
    </>
  );
}

/**
 * The iframe of each user tab in the web runner. Like a saved tab in Electron, a tab loads its page
 * only after the panels of its owner show the tab. An app on another machine has no frames, so its
 * tabs show why they cannot show pages instead.
 */
function FrameSurfaces({ runtime }: { runtime: FrameBrowserRuntime }) {
  const { tabs } = useBrowserTabs();
  const placed = usePlacedSurfaceKeys(runtime.slots);
  const { frames } = runtime.bridge;
  if (frames === null) return null;
  return Array.from(tabs.values()).map((tab) => {
    const key = browserSurfaceKey(tab.tabId);
    if (!placed.has(key)) return null;
    return (
      <SurfaceFrame
        key={key}
        slots={runtime.slots}
        overlaps={null}
        surfaceKey={key}
        occluders={NO_PAGE_OCCLUDERS}
      >
        {() => (
          <FrameBrowserSurface
            frames={frames}
            focus={runtime.focus}
            controls={runtime.frameControls}
            tabId={tab.tabId}
            initialUrl={tab.url}
          />
        )}
      </SurfaceFrame>
    );
  });
}

/**
 * Places one surface over its panel slot. A native page view draws above the host page, so a
 * surface gives its place to an overlay when the overlay box covers the page box.
 */
function SurfaceFrame({
  slots,
  surfaceKey,
  occluders,
  overlaps,
  children,
}: {
  slots: BrowserSurfaceRegistry<BrowserSlot>;
  surfaceKey: string;
  occluders: readonly PageOccluderBox[];
  /** The registry of host overlay elements, or null for a surface that draws no overlays. */
  overlaps: BrowserSurfaceRegistry<HTMLElement> | null;
  children: (
    placement: ReturnType<typeof useBrowserSurfacePlacement>,
    occluded: boolean,
  ) => ReactNode;
}) {
  const placement = useBrowserSurfacePlacement(slots, surfaceKey);
  const hidden = !placement.visible;
  const occluded = pageIsOccluded(occluders, placement);
  const overlayRef = useCallback(
    (element: HTMLElement | null) => {
      if (element === null || overlaps === null) return;
      return overlaps.register(surfaceKey, element);
    },
    [overlaps, surfaceKey],
  );
  return (
    <div
      className={
        hidden ? "pointer-events-none absolute overflow-hidden" : "absolute overflow-hidden"
      }
      data-browser-surface={surfaceKey}
      style={{
        left: placement.left,
        top: placement.top,
        width: placement.width,
        height: placement.height,
      }}
    >
      {children(placement, occluded)}
      {overlaps ? (
        <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-10" />
      ) : null}
    </div>
  );
}

function DevToolsSurface({
  slots,
  browserTabId,
}: {
  slots: BrowserSurfaceRegistry<BrowserSlot>;
  browserTabId: string;
}) {
  const { data: frontendUrl } = useQuery(browserDevToolsUrlQueryOptions(browserTabId));
  return (
    <SurfaceFrame
      slots={slots}
      surfaceKey={devToolsSurfaceKey(browserTabId)}
      occluders={NO_PAGE_OCCLUDERS}
      overlaps={null}
    >
      {() =>
        frontendUrl === undefined ? null : <DevToolsWebviewSurface frontendUrl={frontendUrl} />
      }
    </SurfaceFrame>
  );
}

/** The surface keys that a panel slot held at least once. A page stays after its slot goes. */
const usePlacedSurfaceKeys = (slots: BrowserSurfaceRegistry<BrowserSlot>): ReadonlySet<string> => {
  const [placed, setPlaced] = useState<ReadonlySet<string>>(() => new Set(slots.keys()));
  useEffect(() => {
    const update = (): void =>
      setPlaced((current) => {
        const added = slots.keys().filter((key) => !current.has(key));
        return added.length === 0 ? current : new Set([...current, ...added]);
      });
    update();
    return slots.subscribe(update);
  }, [slots]);
  return placed;
};
