import { useEffect, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { BrowserFrameBridge } from "@/lib/shell-bridge";
import { cn } from "@/lib/utils";
import type { BrowserFocusRegistry } from "./browser-focus-registry";
import type { BrowserFrameControls } from "./browser-frame-display";
import type { BrowserSurfaceRegistry } from "./browser-surface-registry";
import { startFrameTabController } from "./frame-tab-controller";

/** Features that a page can ask for. The browser of the user still asks the user. */
const FRAME_PERMISSIONS =
  "camera; microphone; geolocation; clipboard-read; clipboard-write; fullscreen; autoplay; encrypted-media; picture-in-picture; screen-wake-lock; web-share";

/**
 * Lets a page do what it does in a browser tab, except navigate the OpenDucktor app itself.
 * The pages never have the origin of the app, so scripts and same-origin access stay safe.
 */
const FRAME_SANDBOX =
  "allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads allow-pointer-lock allow-presentation allow-storage-access-by-user-activation";

/**
 * The page of a web runner tab: an iframe that the browser of the user draws, scrolls, and runs
 * itself. A page of the host loads from its preview origin, and its frame script reports its
 * state. Another site loads at its own URL when it allows frames. The state goes to the host, so
 * the tab list and the saved tabs follow the page.
 */
export function FrameBrowserSurface({
  frames,
  focus,
  controls,
  tabId,
  initialUrl,
}: {
  frames: BrowserFrameBridge;
  focus: Pick<BrowserFocusRegistry, "registerPage" | "focusAddressBar">;
  controls: BrowserSurfaceRegistry<BrowserFrameControls>;
  tabId: string;
  /** The tab URL when the frame mounts. Later pages come from the toolbar and the page itself. */
  initialUrl: string;
}) {
  const hostClient = useHostClient();
  const [element, setElement] = useState<HTMLIFrameElement | null>(null);
  const [startUrl] = useState(initialUrl);
  // A site loads while the host checks that it allows frames. It shows only after the check.
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (element === null) return;
    return startFrameTabController({
      element,
      frames,
      focus,
      controls,
      tabId,
      startUrl,
      setChecking,
      reportState: (state) =>
        hostClient.browserTabFrameState({ tabId, ...state }).catch((cause: unknown) => {
          toast.error("Could not update the browser tab", {
            id: `browser-frame-state:${tabId}`,
            description: errorMessage(cause),
          });
        }),
    });
  }, [element, frames, focus, controls, hostClient, tabId, startUrl]);

  return (
    <iframe
      ref={setElement}
      title="Page"
      allow={FRAME_PERMISSIONS}
      sandbox={FRAME_SANDBOX}
      className={cn("block h-full w-full border-0 bg-white", checking && "invisible")}
      data-testid="browser-frame"
    />
  );
}
