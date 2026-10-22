import {
  BROWSER_BLANK_URL,
  type BrowserNavigation,
  type BrowserTabSummary,
} from "@openducktor/contracts";
import type { ReactElement, ReactNode } from "react";
import {
  type BrowserAnnotation,
  BrowserAnnotationList,
  useBrowserAnnotationStore,
  useBrowserAnnotations,
} from "@/features/browser-annotations";
import type { BrowserTabEntry } from "@/features/session-panels";
import { useHostClient } from "@openducktor/frontend-core/connection/client-connection-react";
import type { BrowserChannel } from "./browser-channel";
import { BrowserPageArea, useDevToolsSize } from "./browser-devtools-dock";
import { useBrowserDevToolsStore } from "./browser-devtools-store";
import type { BrowserFrameControls } from "./browser-frame-display";
import { BrowserNewTab } from "./browser-new-tab";
import { PageOverlays } from "./browser-page-overlays";
import {
  frameReplacement,
  pageReplacement,
  reportBrowserFailure,
} from "./browser-page-replacement";
import {
  type FrameBrowserRuntime,
  useBrowserChannelStatus,
  useBrowserEngineState,
  useBrowserOverlayHost,
  useBrowserRuntime,
  type WebviewBrowserRuntime,
} from "./browser-runtime";
import { BrowserSiteMenuContainer } from "./browser-site-menu-container";
import { browserSurfaceKey } from "./browser-surface-registry";
import { BrowserTabPromptBars } from "./browser-tab-prompts";
import { BrowserDownloadsMenu } from "./components/browser-downloads-menu";
import { BrowserToolbar, BrowserToolbarPlaceholder } from "./components/browser-toolbar";
import { type BrowserAnchors, useBrowserAnchors } from "./use-browser-anchors";
import { useBrowserPicker } from "./use-browser-picker";
import { useBrowserTabPage } from "./use-browser-tab-page";

export type BrowserTabContentProps = {
  entry: BrowserTabEntry;
  tab: BrowserTabSummary | null;
  isShown: boolean;
  addressFocusRequest: number;
};

/**
 * The content of one browser tab in a session panel: toolbar, prompts, the page slot, and in
 * Electron the docked DevTools. A web runner tab shows its page in an iframe of this browser.
 */
export function BrowserTabContent(props: BrowserTabContentProps): ReactElement {
  const runtime = useBrowserRuntime();
  const { tab } = props;
  // A new tab has no host summary for a moment. The placeholder keeps the toolbar in its place and
  // the page hidden, so the tab does not flash before its first page.
  if (tab === null) return <BrowserTabPlaceholder />;
  return runtime.surface === "webview" ? (
    <WebviewTabContent {...props} tab={tab} runtime={runtime} />
  ) : (
    <FrameTabContent {...props} tab={tab} runtime={runtime} />
  );
}

/** The props of a tab view whose tab the host lists. */
type ListedTabContentProps = Omit<BrowserTabContentProps, "tab"> & { tab: BrowserTabSummary };

/** A tab before its host summary: a toolbar with no actions and an empty page. */
function BrowserTabPlaceholder(): ReactElement {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="browser-tab-view" aria-busy="true">
      <BrowserToolbarPlaceholder />
      <div className="min-h-0 flex-1 bg-card" />
    </div>
  );
}

/** An Electron tab: its `<webview>` page, prompts, annotations, agent markers, and DevTools. */
function WebviewTabContent({
  entry,
  tab,
  isShown,
  addressFocusRequest,
  runtime,
}: ListedTabContentProps & { runtime: WebviewBrowserRuntime }): ReactElement {
  const { channel } = runtime;
  const hostClient = useHostClient();
  const engine = useBrowserEngineState();
  const overlayHost = useBrowserOverlayHost(runtime.overlays, browserSurfaceKey(entry.tabId));
  const { live } = tab;
  const picker = useBrowserPicker(channel, entry.tabId, live);
  // A browser tab owner is also the owner of its pending annotations.
  const { ownerKey, annotations } = useBrowserAnnotations(tab.owner);
  const anchors = useBrowserAnchors(channel, entry.tabId, live, tab.url, annotations);

  const navigate = (navigation: BrowserNavigation) =>
    hostClient.browserTabNavigate({ tabId: entry.tabId, navigation });
  // A saved tab that failed to start tries the start again.
  const reload = () =>
    !tab.started
      ? hostClient.browserTabStart({ tabId: entry.tabId }).then(() => undefined)
      : navigate({ kind: "reload" });
  const newTabPage = useNewTabPage(tab, navigate);
  const replacement = pageReplacement(hostClient, tab, engine, reload) ?? newTabPage;
  const page = useBrowserTabPage({ tabId: entry.tabId, isShown, addressFocusRequest, replacement });
  // The Electron engine has DevTools for each page while it is ready.
  const supportsDevTools = engine?.kind === "ready";
  const devToolsSize = useDevToolsSize(entry.tabId, supportsDevTools);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="browser-tab-view">
      <BrowserToolbar
        tab={tab}
        {...page.toolbar}
        onNavigate={navigate}
        tools={{
          supportsDevTools,
          pickerActive: picker.state.active,
          annotationCount: annotations.filter((annotation) => annotation.status === "pending")
            .length,
          annotationsContent:
            ownerKey === null ? null : (
              <AnnotationListContent
                ownerKey={ownerKey}
                annotations={annotations}
                anchors={anchors}
              />
            ),
          siteMenuContent: (
            <BrowserSiteMenuContainer workspaceId={tab.owner.workspaceId} url={tab.url} />
          ),
          downloadsContent: tab.downloads.length > 0 ? <DownloadsContent tab={tab} /> : null,
          onTogglePicker: picker.toggle,
          onSetShared: (shared) =>
            hostClient.browserTabSetShared({ tabId: tab.tabId, shared }).then(() => undefined),
          devToolsOpen: devToolsSize !== undefined,
          onToggleDevTools: () => useBrowserDevToolsStore.getState().toggle(tab.tabId),
        }}
      />
      <ChannelFailure channel={channel} />
      <BrowserTabPromptBars tab={tab} bridge={runtime.bridge} />
      <BrowserPageArea
        tabId={entry.tabId}
        devToolsSize={devToolsSize}
        showsDevTools={isShown && live}
        page={
          <div className="relative h-full min-h-0 overflow-hidden" {...page.slotProps}>
            {replacement}
          </div>
        }
      />
      {overlayHost && replacement === null ? (
        <PageOverlays
          channel={channel}
          tab={tab}
          picker={picker}
          ownerKey={ownerKey}
          annotations={annotations}
          anchors={anchors}
          overlayHost={overlayHost}
        />
      ) : null}
    </div>
  );
}

/**
 * A web runner tab. Its page is an iframe of this browser, so the browser of the user shows the
 * dialogs, permissions, file choosers, and downloads of the page.
 */
function FrameTabContent({
  entry,
  tab,
  isShown,
  addressFocusRequest,
  runtime,
}: ListedTabContentProps & { runtime: FrameBrowserRuntime }): ReactElement {
  const navigate = (navigation: BrowserNavigation) =>
    navigateFrame(runtime.frameControls.get(entry.tabId), navigation);
  const newTabPage = useNewTabPage(tab, navigate);
  const replacement =
    frameReplacement(tab, runtime.bridge.frames, () => navigate({ kind: "reload" })) ?? newTabPage;
  const page = useBrowserTabPage({ tabId: entry.tabId, isShown, addressFocusRequest, replacement });

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="browser-tab-view">
      <BrowserToolbar tab={tab} {...page.toolbar} onNavigate={navigate} tools={null} />
      <div className="relative min-h-0 flex-1 overflow-hidden" {...page.slotProps}>
        {replacement}
      </div>
    </div>
  );
}

/** True for a tab with no address, which shows the new tab page in place of a blank page. */
const showsBrowserNewTab = (tab: BrowserTabSummary): boolean =>
  tab.url === BROWSER_BLANK_URL && !tab.loading && tab.error === null;

/**
 * The new tab page of a tab with no address, or null. A chosen page loads in the tab and takes the
 * keyboard focus, as after Enter in the address bar.
 */
const useNewTabPage = (
  tab: BrowserTabSummary,
  navigate: (navigation: BrowserNavigation) => Promise<void>,
): ReactNode => {
  const { focus } = useBrowserRuntime();
  if (!showsBrowserNewTab(tab)) return null;
  const { tabId } = tab;
  return (
    <BrowserNewTab
      tab={tab}
      onOpen={(url) =>
        void navigate({ kind: "address", address: url }).then(
          () => focus.focusPage(tabId, { fromKeyboard: false }),
          reportBrowserFailure("Could not open the page"),
        )
      }
    />
  );
};

/** Sends a toolbar navigation to the iframe of a web runner tab. */
const navigateFrame = async (
  controls: BrowserFrameControls | undefined,
  navigation: BrowserNavigation,
): Promise<void> => {
  if (controls === undefined) {
    throw new Error("The page is still starting. Try again in a moment.");
  }
  if (navigation.kind === "address") {
    await controls.load(navigation.address);
    return;
  }
  controls.run(navigation.kind);
};

/** The last channel failure while the channel is down. The channel reconnects by itself. */
function ChannelFailure({ channel }: { channel: BrowserChannel }): ReactElement | null {
  const status = useBrowserChannelStatus(channel);
  const failure = status === "connected" ? null : channel.failure();
  if (failure === null) return null;
  return (
    <p role="alert" className="shrink-0 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
      The page connection failed: {failure} OpenDucktor tries again.
    </p>
  );
}

function AnnotationListContent({
  ownerKey,
  annotations,
  anchors,
}: {
  ownerKey: string;
  annotations: readonly BrowserAnnotation[];
  anchors: BrowserAnchors;
}): ReactElement {
  const store = useBrowserAnnotationStore().getState();
  return (
    <BrowserAnnotationList
      annotations={annotations}
      offPageIds={anchors.offPageIds}
      onSelect={(annotation) => anchors.reveal(annotation.id)}
      onUpdate={(annotation, changes) => store.updateAnnotation(ownerKey, annotation.id, changes)}
      onRemove={(annotation) => store.removeAnnotation(ownerKey, annotation.id)}
    />
  );
}

/** The downloads of a tab. A finished download shows in its folder. */
function DownloadsContent({ tab }: { tab: BrowserTabSummary }): ReactElement {
  const hostClient = useHostClient();
  return (
    <BrowserDownloadsMenu
      downloads={tab.downloads}
      onReveal={(downloadId) =>
        void hostClient
          .browserDownloadReveal({ tabId: tab.tabId, downloadId })
          .catch(reportBrowserFailure("Could not show the download"))
      }
    />
  );
}
