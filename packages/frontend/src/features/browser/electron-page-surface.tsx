import { type ReactElement, useEffect, useState } from "react";
import type { ElectronBrowserBridge } from "@/lib/shell-bridge";
import type { BrowserFocusRegistry } from "./browser-focus-registry";
import { reportBrowserFailure } from "./browser-page-replacement";
import type { BrowserSurfacePlacement } from "./use-browser-surface-placement";

/** Undefined while the snapshot of a hidden page is not ready. Null when it failed. */
type PageSnapshot = string | null | undefined;

type ElectronPageSurfaceProps = {
  bridge: ElectronBrowserBridge;
  focus: Pick<BrowserFocusRegistry, "registerPage">;
  occluded: boolean;
  placement: BrowserSurfacePlacement;
  tabId: string;
};

/**
 * The native page view of one browser tab. The host draws the page, so the browser layer only
 * says where the page shows and when a host overlay needs its place.
 *
 * While an overlay opens, the page keeps its place for a moment, then turns into its last
 * snapshot. The snapshot keeps the page visible to the user under the overlay, and the page view
 * moves out of the window until the overlay closes. The snapshot stays until the page is back.
 */
export function ElectronPageSurface({
  bridge,
  focus,
  occluded,
  placement,
  tabId,
}: ElectronPageSurfaceProps): ReactElement | null {
  const [snapshot, setSnapshot] = useState<PageSnapshot>(undefined);
  const frozen = placement.visible && occluded;
  // Keep the page in place until its snapshot is ready, so the overlay does not flash a gap.
  const waitingForSnapshot = frozen && snapshot === undefined;

  useEffect(
    () =>
      focus.registerPage(tabId, () => {
        void bridge
          .focusPage(tabId)
          .catch(reportBrowserFailure("Could not focus the browser page"));
      }),
    [bridge, focus, tabId],
  );

  useEffect(() => {
    if (!frozen) return;
    let cancelled = false;
    bridge.capturePage(tabId).then(
      (url) => {
        if (!cancelled) setSnapshot(url);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setSnapshot(null);
        reportBrowserFailure("Could not keep the page visible under the window")(cause);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bridge, frozen, tabId]);

  // A native page outlives its React component, so an unmounted surface gives up its place. A tab
  // that closes first has no place left, and a component that unmounts cannot show a failure.
  useEffect(
    () => () => {
      void bridge.setSurface({ tabId, visible: false }).catch(() => undefined);
    },
    [bridge, tabId],
  );

  useEffect(() => {
    if (!placement.visible) {
      setSnapshot(undefined);
      void bridge
        .setSurface({ tabId, visible: false })
        .catch(reportBrowserFailure("Could not place the browser page"));
      return;
    }
    if (waitingForSnapshot) return;
    if (frozen) {
      void bridge
        .setSurface({ tabId, visible: false })
        .catch(reportBrowserFailure("Could not place the browser page"));
      return;
    }
    // The native page shows over the snapshot when the host places it. Removing the snapshot
    // before then would show an empty slot for a frame.
    let cancelled = false;
    bridge
      .setSurface({
        tabId,
        visible: true,
        bounds: {
          x: placement.left,
          y: placement.top,
          width: placement.width,
          height: placement.height,
        },
      })
      .then(() => {
        if (!cancelled) setSnapshot(undefined);
      }, reportBrowserFailure("Could not place the browser page"));
    return () => {
      cancelled = true;
    };
  }, [
    bridge,
    frozen,
    placement.height,
    placement.left,
    placement.top,
    placement.visible,
    placement.width,
    tabId,
    waitingForSnapshot,
  ]);

  return snapshot === undefined || snapshot === null ? null : (
    <img
      alt=""
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full object-fill"
      data-testid="browser-page-snapshot"
      draggable={false}
      src={snapshot}
    />
  );
}
