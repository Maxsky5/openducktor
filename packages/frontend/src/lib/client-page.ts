import type { ShellBridge } from "./shell-bridge";

type PageBridge = Pick<ShellBridge, "dispose" | "setActive"> & {
  notifications: Pick<ShellBridge["notifications"], "dispose">;
  remoteConnection?: Pick<NonNullable<ShellBridge["remoteConnection"]>, "readState">;
};

/** Owns the selected client's page events until the document leaves the browser. */
export function watchClientPage(
  bridge: PageBridge | undefined,
  hostChanged: () => boolean,
): () => Promise<void> {
  const page = window;
  const pageDocument = document;
  let released: Promise<void> | undefined;
  const reportFailure = (cause: unknown) =>
    console.error("Could not release the host client.", cause);
  const leave = (): Promise<void> => {
    released ??= (async () => {
      try {
        bridge?.notifications.dispose();
      } finally {
        await bridge?.dispose?.();
      }
    })();
    return released;
  };
  const onHide = (event: PageTransitionEvent) => {
    if (event.persisted) {
      if (bridge && !bridge.setActive) void leave().catch(reportFailure);
      else if (!released) bridge?.setActive?.(false);
      return;
    }
    page.removeEventListener("pagehide", onHide);
    page.removeEventListener("pageshow", onShow);
    pageDocument.removeEventListener("visibilitychange", onVisibility);
    void leave().catch(reportFailure);
  };
  const onShow = (event: PageTransitionEvent) => {
    if (!event.persisted) return;
    if (released || hostChanged()) {
      // Released clients cannot resume, including local clients that rebuild on history restore.
      void leave().catch(reportFailure);
      page.location.reload();
      return;
    }
    bridge?.setActive?.(!pageDocument.hidden);
  };
  const onVisibility = () => {
    // Hidden tabs retain their live connection. Only a paused cached page needs activation.
    if (
      !released &&
      !pageDocument.hidden &&
      bridge?.remoteConnection?.readState().status === "idle"
    ) {
      bridge.setActive?.(true);
    }
  };
  page.addEventListener("pagehide", onHide);
  page.addEventListener("pageshow", onShow);
  pageDocument.addEventListener("visibilitychange", onVisibility);
  return leave;
}
