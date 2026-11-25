import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createBrowserTabSummaryFixture } from "@openducktor/frontend-core/test-support/browser-tab-fixtures";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { createShellBridgeFixture, withShellPlatform } from "@/test-utils/focused-fixture";
import { QueryProvider } from "@/test-utils/query-provider";
import { BrowserLayer } from "./browser-layer";
import { BrowserRuntimeProvider, useBrowserTabs } from "./browser-runtime";
import { BrowserTabContent } from "./browser-tab-content";

const previewOrigin = new URLSearchParams(location.search).get("preview");
if (!previewOrigin) throw new Error("The browser test needs a preview origin.");

const tab = createBrowserTabSummaryFixture({ page: "frame", started: false });
const connection = createTestClientConnection({
  client: {
    browserTabsList: async () => ({ tabs: [tab] }),
    browserStateRead: async () => ({ kind: "ready", engine: "electron_webview" }),
    browserTabFrameState: async () => {},
  },
});
const shell = createShellBridgeFixture({
  bridge: {
    browser: {
      surface: "frame",
      frames: { source: async () => ({ kind: "preview", origin: previewOrigin }) },
    },
  },
});

function Panel() {
  const [open, setOpen] = useState(false);
  const listed = useBrowserTabs().tabs.get(tab.tabId);
  return (
    <>
      <button type="button" data-toggle-tab disabled={!listed} onClick={() => setOpen(!open)}>
        {open ? "Hide browser tab" : "Show browser tab"}
      </button>
      {open && listed ? (
        <BrowserTabContent
          entry={{ id: `browser:${tab.tabId}`, kind: "browser", tabId: tab.tabId }}
          tab={listed}
          isShown
          addressFocusRequest={0}
        />
      ) : null}
      <BrowserLayer />
    </>
  );
}

const container = document.getElementById("fixture");
if (!container) throw new Error("The browser test mount is missing.");
const root = createRoot(container);
flushSync(() => {
  root.render(
    withShellPlatform(
      <QueryProvider connection={connection}>
        <BrowserRuntimeProvider>
          <Panel />
        </BrowserRuntimeProvider>
      </QueryProvider>,
      shell,
    ),
  );
});
