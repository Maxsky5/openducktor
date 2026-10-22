import type { BrowserFrameCommand } from "@openducktor/contracts";

/** Why a web runner app on another machine cannot show browser tabs. */
export const BROWSER_TABS_NEED_LOCAL_APP =
  "Browser tabs need the OpenDucktor app on the machine that runs OpenDucktor. Open the app there at http://localhost, http://127.0.0.1, or http://[::1].";

/** What the toolbar of a frame tab asks its iframe to do. */
export type BrowserFrameControls = {
  /** Opens a page in the frame. A page that cannot show reports its error in the tab. */
  load(url: string): Promise<void>;
  run(command: BrowserFrameCommand): void;
};
