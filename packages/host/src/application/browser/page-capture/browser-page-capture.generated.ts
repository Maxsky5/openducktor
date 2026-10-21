import { bundleBrowserPageCapture } from "./browser-page-capture.macro" with { type: "macro" };

/** The page code of the annotation capture and bippy as one script. Bun makes it at build time. */
export const BROWSER_PAGE_CAPTURE_BUNDLE: string = bundleBrowserPageCapture();
