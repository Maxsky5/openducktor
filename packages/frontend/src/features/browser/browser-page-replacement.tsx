import {
  type BrowserEngineState,
  type BrowserTabSummary,
  browserEngineNotReadyMessage,
} from "@openducktor/contracts";
import { AppWindow, MonitorX } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { HostClient } from "@openducktor/host-client";
import { type BrowserFrameBridge, getShellBridge } from "@/lib/shell-bridge";
import { BROWSER_TABS_NEED_LOCAL_APP } from "./browser-frame-display";
import { BrowserCertificateView } from "./components/browser-certificate-view";
import type { BrowserPromptOf } from "./components/browser-component-types";
import { BrowserLoadErrorView } from "./components/browser-load-error-view";
import { BrowserPopupWindowPlaceholder } from "./components/browser-popup-window-placeholder";
import { BrowserStateView } from "./components/browser-state-view";

/** The view that replaces the iframe of a web runner tab, or null when the page shows. */
export const frameReplacement = (
  tab: BrowserTabSummary,
  frames: BrowserFrameBridge | null,
  reload: () => Promise<void>,
): ReactNode => {
  if (frames === null) {
    return (
      <BrowserStateView icon={MonitorX} tone="neutral" title="This app cannot show pages">
        <p>{BROWSER_TABS_NEED_LOCAL_APP}</p>
      </BrowserStateView>
    );
  }
  return tab.error ? <LoadErrorView error={tab.error} reload={reload} /> : null;
};

/**
 * The view that replaces the page, or null when the page shows. The page surface hides while
 * this view shows, so the view never sits under a page.
 */
export const pageReplacement = (
  client: HostClient,
  tab: BrowserTabSummary,
  engine: BrowserEngineState | null,
  reload: () => Promise<void>,
): ReactNode => {
  if (engine !== null && engine.kind !== "ready") {
    return (
      <BrowserStateView icon={AppWindow} tone="neutral" title="No window can show this page">
        <p>{browserEngineNotReadyMessage(engine)}</p>
      </BrowserStateView>
    );
  }
  // A saved tab gets its page when the panels start it.
  if (!tab.started && tab.error === null) {
    return (
      <p
        role="status"
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
      >
        Opening the page...
      </p>
    );
  }
  if (tab.surface === "popup_window") {
    return (
      <BrowserPopupWindowPlaceholder
        title={tab.title}
        onShowWindow={() =>
          client
            .browserPopupWindowShow({ tabId: tab.tabId })
            .catch(reportBrowserFailure("Could not show the popup window"))
        }
      />
    );
  }
  const certificate = tab.prompts.find(
    (prompt): prompt is BrowserPromptOf<"certificate"> => prompt.kind === "certificate",
  );
  if (certificate) {
    const answer = (proceed: boolean) =>
      client.browserPromptAnswer({
        tabId: tab.tabId,
        promptId: certificate.promptId,
        answer: { kind: "certificate", proceed },
      });
    return (
      <BrowserCertificateView
        prompt={certificate}
        onProceed={() => answer(true)}
        onBack={() => answer(false)}
      />
    );
  }
  return tab.error ? <LoadErrorView error={tab.error} reload={reload} /> : null;
};

function LoadErrorView({
  error,
  reload,
}: {
  error: NonNullable<BrowserTabSummary["error"]>;
  reload: () => Promise<void>;
}): ReactElement {
  return (
    <BrowserLoadErrorView
      error={error}
      onReload={() => void reload().catch(reportBrowserFailure("Could not reload the page"))}
      onOpenSite={() =>
        void getShellBridge()
          .openExternalUrl(error.url)
          .catch(reportBrowserFailure("Could not open the page in the browser"))
      }
    />
  );
}

/** Shows a failed browser action as an error toast. */
export const reportBrowserFailure = (title: string) => (cause: unknown) => {
  toast.error(title, { description: errorMessage(cause) });
};
