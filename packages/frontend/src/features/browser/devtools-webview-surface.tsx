import { createElement } from "react";

/** The Electron partition of the bundled DevTools frontend. It holds no page data of a tab. */
const DEVTOOLS_PARTITION = "persist:openducktor-devtools";

/**
 * The bundled Electron DevTools frontend of one browser tab. DevTools are the only `<webview>` of
 * the renderer: page tabs are native views that the engine places.
 */
export function DevToolsWebviewSurface({ frontendUrl }: { frontendUrl: string }) {
  return createElement("webview", {
    partition: DEVTOOLS_PARTITION,
    src: frontendUrl,
    className: "flex h-full w-full bg-background",
    "data-testid": "browser-devtools-webview",
  });
}
