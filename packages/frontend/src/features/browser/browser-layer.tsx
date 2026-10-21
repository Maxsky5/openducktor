import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { browserDevToolsUrlQueryOptions } from "@/state/queries/browser";
import type { BrowserChannel } from "./browser-channel";
import { useBrowserDevToolsStore } from "./browser-devtools-store";
import {
  type FrameBrowserRuntime,
  useBrowserRuntime,
  useBrowserTabs,
  type WebviewBrowserRuntime,
} from "./browser-runtime";
import type { BrowserSlot, BrowserSurfaceRegistry } from "./browser-surface-registry";
import { browserSurfaceKey, devToolsSurfaceKey } from "./browser-surface-registry";
import { FrameBrowserSurface } from "./frame-surface";
import { useBrowserSurfacePlacement } from "./use-browser-surface-placement";
import { DevToolsWebviewSurface, WebviewBrowserSurface } from "./webview-surface";

/**
 * The page surfaces of all browser tabs, mounted once in the app shell. Panels render only slots,
 * and this layer places each surface over its slot. A page thus survives panel moves, owner
 * switches, and route changes: Electron keeps the `<webview>` of each started tab mounted, and the
 * web runner keeps the iframe of each user tab mounted.
 */
export function BrowserLayer() {
  const runtime = useBrowserRuntime();
  return (
    <div className="pointer-events-none fixed inset-0 z-10" data-testid="browser-layer">
      {runtime.surface === "webview" ? (
        <WebviewSurfaces runtime={runtime} />
      ) : (
        <FrameSurfaces runtime={runtime} />
      )}
    </div>
  );
}

/** The `<webview>` of each started panel tab, and the docked DevTools that show. */
function WebviewSurfaces({ runtime }: { runtime: WebviewBrowserRuntime }) {
  const { tabs } = useBrowserTabs();
  const { bridge, channel, overlays, slots } = runtime;
  const awake = useAwakeTabs(channel);
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
            overlays={overlays}
            surfaceKey={key}
            awake={awake.has(tab.tabId)}
          >
            <WebviewBrowserSurface
              bridge={bridge}
              channel={channel}
              focus={runtime.focus}
              tabId={tab.tabId}
              workspaceId={tab.owner.workspaceId}
            />
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
 * The iframe of each user tab in the web runner. An app on another machine has no frames, so its
 * tabs show why they cannot show pages instead.
 */
function FrameSurfaces({ runtime }: { runtime: FrameBrowserRuntime }) {
  const { tabs } = useBrowserTabs();
  const { frames } = runtime.bridge;
  if (frames === null) return null;
  return Array.from(tabs.values()).map((tab) => {
    const key = browserSurfaceKey(tab.tabId);
    return (
      <SurfaceFrame key={key} slots={runtime.slots} overlays={null} surfaceKey={key} awake={false}>
        <FrameBrowserSurface
          frames={frames}
          focus={runtime.focus}
          controls={runtime.frameControls}
          tabId={tab.tabId}
          initialUrl={tab.url}
        />
      </SurfaceFrame>
    );
  });
}

/**
 * Places one surface over its panel slot. `overlays` gets the overlay element above the page, where
 * a tab view draws prompts and markers. Frame tabs draw none.
 */
function SurfaceFrame({
  slots,
  overlays,
  surfaceKey,
  awake,
  children,
}: {
  slots: BrowserSurfaceRegistry<BrowserSlot>;
  overlays: BrowserSurfaceRegistry<HTMLElement> | null;
  surfaceKey: string;
  awake: boolean;
  children: ReactNode;
}) {
  const placement = useBrowserSurfacePlacement(slots, surfaceKey);
  const hidden = !placement.visible;
  const overlayRef = useCallback(
    (element: HTMLElement | null) =>
      element && overlays ? overlays.register(surfaceKey, element) : undefined,
    [overlays, surfaceKey],
  );
  return (
    <div
      className={cn(
        "absolute overflow-hidden",
        hidden ? "pointer-events-none" : "pointer-events-auto",
        hidden && !awake && "invisible",
        hidden && awake && "opacity-0",
      )}
      data-browser-surface={surfaceKey}
      style={{
        left: placement.left,
        top: placement.top,
        width: placement.width,
        height: placement.height,
      }}
    >
      {children}
      {overlays ? <div ref={overlayRef} className="pointer-events-none absolute inset-0" /> : null}
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
      overlays={null}
      surfaceKey={devToolsSurfaceKey(browserTabId)}
      awake={false}
    >
      {frontendUrl === undefined ? null : <DevToolsWebviewSurface frontendUrl={frontendUrl} />}
    </SurfaceFrame>
  );
}

/** Tabs that an agent or DevTools uses now. Their hidden `<webview>` must stay drawn. */
const useAwakeTabs = (channel: BrowserChannel): ReadonlySet<string> => {
  const [awake, setAwake] = useState<ReadonlySet<string>>(new Set());
  useEffect(
    () =>
      channel.subscribe((message) => {
        if (message.type !== "surface_wake") return;
        setAwake((current) => {
          const next = new Set(current);
          if (message.awake) {
            next.add(message.tabId);
          } else {
            next.delete(message.tabId);
          }
          return next;
        });
      }),
    [channel],
  );
  return awake;
};
