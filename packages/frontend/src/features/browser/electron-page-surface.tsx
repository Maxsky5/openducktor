import { type ReactElement, useEffect, useState } from "react";
import type { ElectronBrowserBridge } from "@/lib/shell-bridge";
import type { BrowserFocusRegistry } from "./browser-focus-registry";
import { reportBrowserFailure } from "./browser-page-replacement";
import type { BrowserSurfacePlacement } from "./use-browser-surface-placement";

/** Undefined while the snapshot of a covered page is not ready. Null when it failed. */
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
 * says where the page shows and when a host overlay covers it.
 *
 * A native page draws above every element of the window. While an overlay covers the page, the
 * surface shows a snapshot of the page in its place, and the host keeps the live page drawing
 * where the user cannot see it. The page is covered only after the snapshot painted, and the
 * snapshot leaves only after the live page is back, so the user never sees a gap.
 */
export function ElectronPageSurface({
  bridge,
  focus,
  occluded,
  placement,
  tabId,
}: ElectronPageSurfaceProps): ReactElement | null {
  const [snapshot, setSnapshot] = useState<PageSnapshot>(undefined);
  /** The snapshot image painted, so the live page can make way for it. */
  const [snapshotPainted, setSnapshotPainted] = useState(false);
  const covering = placement.visible && occluded;
  const snapshotReady = snapshot === null || (snapshot !== undefined && snapshotPainted);

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
    if (!covering) return;
    // An older snapshot can still show while the live page returns. The new one must paint first.
    setSnapshotPainted(false);
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
  }, [bridge, covering, tabId]);

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
      setSnapshotPainted(false);
      void bridge
        .setSurface({ tabId, visible: false })
        .catch(reportBrowserFailure("Could not place the browser page"));
      return;
    }
    // The live page keeps its place until its snapshot painted, so the overlay never shows a gap.
    if (covering && !snapshotReady) return;
    let cancelled = false;
    bridge
      .setSurface({
        tabId,
        visible: true,
        covered: covering,
        bounds: {
          x: placement.left,
          y: placement.top,
          width: placement.width,
          height: placement.height,
        },
      })
      .then(() => {
        // The live page shows over the snapshot when the host places it, so the snapshot can go.
        if (cancelled || covering) return;
        setSnapshot(undefined);
        setSnapshotPainted(false);
      }, reportBrowserFailure("Could not place the browser page"));
    return () => {
      cancelled = true;
    };
  }, [
    bridge,
    covering,
    placement.height,
    placement.left,
    placement.top,
    placement.visible,
    placement.width,
    snapshotReady,
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
      // The next frame shows the loaded image, and only then the live page can make way for it.
      onLoad={() => requestAnimationFrame(() => setSnapshotPainted(true))}
    />
  );
}
