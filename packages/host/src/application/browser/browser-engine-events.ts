import {
  BROWSER_TAB_LIMIT,
  type BrowserDownload,
  type BrowserNotice,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { BrowserEngineEvent, BrowserEnginePort } from "../../ports/browser-engine-port";
import type { BrowserPromptBook } from "./browser-prompt-book";
import type { BrowserSitePermissions } from "./browser-site-permissions";
import type { BrowserTabRegistry } from "./browser-tab-registry";
import type { BrowserTabService } from "./browser-tab-service";

export type BrowserEngineEventsInput = {
  engine: BrowserEnginePort;
  registry: BrowserTabRegistry;
  prompts: BrowserPromptBook;
  tabs: BrowserTabService;
  sitePermissions: BrowserSitePermissions;
  runJob(job: Effect.Effect<void>): void;
  reportFailure(operation: string, cause: unknown): void;
};

/**
 * Applies engine events to the tabs: popups, permission requests, certificate errors, downloads,
 * page notifications, held navigations, refused schemes, and engine state changes.
 */
export const createBrowserEngineEvents = ({
  engine,
  registry,
  prompts,
  tabs,
  sitePermissions,
  runJob,
  reportFailure,
}: BrowserEngineEventsInput) => {
  /** Certificate exceptions that the user accepted, by workspace. They end with the host. */
  const certificateExceptions = new Map<string, Set<string>>();

  /** Tells the owner of a tab about a page event. A closed tab gets no notice. */
  const publishNotice = (tabId: string, notice: BrowserNotice): void => {
    const record = registry.get(tabId);
    if (record) {
      registry.publish({ type: "notice", tabId, owner: record.summary.owner, notice });
    }
  };

  const closeEngineTab = (tabId: string, operation: string) =>
    runJob(
      engine
        .closeTab(tabId)
        .pipe(Effect.catch((cause) => Effect.sync(() => reportFailure(operation, cause)))),
    );

  const handlePopup = (event: Extract<BrowserEngineEvent, { type: "popup_opened" }>) =>
    tabs.addPopup(event).pipe(
      Effect.map((result) => {
        if (result === "added") return;
        closeEngineTab(event.tabId, `browser.popup.${result}`);
        if (result === "limit") {
          publishNotice(event.openerTabId, { kind: "popup_limit", limit: BROWSER_TAB_LIMIT });
        }
      }),
    );

  const handlePermission = (event: Extract<BrowserEngineEvent, { type: "permission_requested" }>) =>
    Effect.gen(function* () {
      const record = registry.get(event.tabId);
      if (!record) {
        event.respond(false);
        return;
      }
      // The request belongs to the document that made it. When the engine reports its end, its
      // prompt goes away, and no saved choice or answer applies to it any more.
      let ended = false;
      let promptId: string | null = null;
      const stopWatching = event.onEnded(() => {
        ended = true;
        if (promptId !== null) prompts.remove(event.tabId, promptId);
      });
      const isCurrent = () => !ended;
      const answered = yield* sitePermissions.answerFromSaved(
        record.workspaceId,
        event.origin,
        event.permission,
        (granted) => {
          if (!ended) event.respond(granted);
        },
      );
      if (answered || ended) {
        stopWatching();
        return;
      }
      const prompt = prompts.add(
        event.tabId,
        { kind: "permission", origin: event.origin, permission: event.permission },
        // The answer can wait for other permission work of the workspace. The end of the document
        // stays watched until the answer applies, so an answer of an ended document does nothing.
        (answer) =>
          (answer.kind === "permission"
            ? sitePermissions.answerAndSave(
                record.workspaceId,
                event.origin,
                event.permission,
                answer.allow,
                event.respond,
                isCurrent,
              )
            : Effect.void
          ).pipe(Effect.ensuring(Effect.sync(stopWatching))),
        // A navigation or a tab close removes the prompt, which denies the request.
        () => {
          stopWatching();
          event.respond(false);
        },
      );
      promptId = prompt.promptId;
    }).pipe(
      Effect.catch((cause) =>
        Effect.sync(() => {
          event.respond(false);
          reportFailure("browser.permission.request", cause);
        }),
      ),
    );

  const handleCertificate = (event: Extract<BrowserEngineEvent, { type: "certificate_error" }>) => {
    const record = registry.get(event.tabId);
    if (!record) {
      event.respond(false);
      return;
    }
    const accepted = certificateExceptions.get(record.workspaceId)?.has(event.host) === true;
    // Only a page error asks the user. A subresource of another host stays blocked.
    if (accepted || !event.mainFrame) {
      event.respond(accepted);
      return;
    }
    event.respond(false);
    prompts.removeKind(event.tabId, "certificate");
    prompts.add(
      event.tabId,
      { kind: "certificate", host: event.host, url: event.url, error: event.error },
      (answer) => {
        if (answer.kind !== "certificate" || !answer.proceed) {
          return Effect.void;
        }
        let hosts = certificateExceptions.get(record.workspaceId);
        if (!hosts) {
          hosts = new Set();
          certificateExceptions.set(record.workspaceId, hosts);
        }
        hosts.add(event.host);
        return tabs.navigate(event.tabId, { kind: "address", address: event.url });
      },
    );
  };

  const handleHeldNavigation = (
    event: Extract<BrowserEngineEvent, { type: "navigation_held" }>,
  ) => {
    const navigation = tabs.heldNavigation(event.tabId, event.url);
    prompts.removeKind(event.tabId, "leave_page");
    prompts.add(
      event.tabId,
      {
        kind: "leave_page",
        url: navigation?.kind === "url" ? navigation.url : null,
        startedByAgent: registry.get(event.tabId)?.summary.agentActive ?? false,
      },
      (answer) => {
        if (answer.kind !== "leave_page" || !answer.leave || navigation === null) {
          return Effect.void;
        }
        return tabs.leaveHeldPage(event.tabId, navigation).pipe(
          Effect.asVoid,
          Effect.catch((cause) =>
            Effect.sync(() => reportFailure("browser.navigation.leave_page", cause)),
          ),
        );
      },
    );
  };

  const handle = (event: BrowserEngineEvent): void => {
    switch (event.type) {
      case "tab_attached":
        runJob(tabs.attach(event.tabId));
        return;
      case "tab_detached":
        runJob(tabs.detach(event.tabId));
        return;
      case "tab_ended":
        runJob(
          tabs
            .endTab(event.tabId)
            .pipe(
              Effect.catch((cause) => Effect.sync(() => reportFailure("browser.tab.end", cause))),
            ),
        );
        return;
      case "popup_opened":
        runJob(handlePopup(event));
        return;
      case "permission_requested":
        runJob(handlePermission(event));
        return;
      case "certificate_error":
        handleCertificate(event);
        return;
      case "download_updated":
        registry.update(event.tabId, (summary) => ({
          ...summary,
          downloads: upsertDownload(summary.downloads, event.download),
        }));
        return;
      case "page_notification":
        publishNotice(event.tabId, {
          kind: "page_notification",
          origin: event.origin,
          title: event.title,
          body: event.body,
        });
        return;
      case "navigation_held":
        handleHeldNavigation(event);
        return;
      case "scheme_refused":
        publishNotice(event.tabId, { kind: "scheme_refused", scheme: event.scheme });
        return;
      case "state_changed":
        registry.publish({ type: "engine_changed", state: event.state });
        return;
    }
  };

  return {
    handle,
    clearWorkspace: (workspaceId: string) => certificateExceptions.delete(workspaceId),
  };
};

const upsertDownload = (downloads: BrowserDownload[], download: BrowserDownload) => {
  const index = downloads.findIndex((item) => item.downloadId === download.downloadId);
  if (index === -1) {
    return [...downloads, download];
  }
  return downloads.map((item, position) => (position === index ? download : item));
};
