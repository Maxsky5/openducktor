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
 * moves out of the window until the overlay closes.
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
    if (!frozen) {
      setSnapshot(undefined);
      return;
    }
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

  useEffect(() => {
    if (!placement.visible) {
      void bridge
        .setSurface({ tabId, visible: false })
        .catch(reportBrowserFailure("Could not place the browser page"));
      return;
    }
    // Keep the page in place until its snapshot is ready, so the overlay does not flash a gap.
    if (frozen && snapshot === undefined) return;
    if (frozen) {
      void bridge
        .setSurface({ tabId, visible: false })
        .catch(reportBrowserFailure("Could not place the browser page"));
      return;
    }
    void bridge
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
      .catch(reportBrowserFailure("Could not place the browser page"));
  }, [
    bridge,
    frozen,
    placement.height,
    placement.left,
    placement.top,
    placement.visible,
    placement.width,
    snapshot,
    tabId,
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
