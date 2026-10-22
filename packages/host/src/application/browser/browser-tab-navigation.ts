import type { BrowserNavigation } from "@openducktor/contracts";
import { Effect } from "effect";
import type {
  BrowserEngineError,
  BrowserEnginePort,
  CdpCommandError,
} from "../../ports/browser-engine-port";
import { navigationHistoryResultSchema } from "../../ports/browser-cdp-schemas";
import type { BrowserHeldNavigation, BrowserHostTabSession } from "./browser-host-tab-session";
import { BrowserServiceError } from "./browser-service-error";
import { resolveBrowserAddress } from "./browser-tab-rules";
import type { BrowserTabRegistry } from "./browser-tab-registry";

/** The toolbar navigation of tabs, and the navigation that a page held with `beforeunload`. */
export const createBrowserTabNavigation = ({
  engine,
  registry,
  liveTabs,
  requireLive,
}: {
  engine: Pick<BrowserEnginePort, "reloadPage" | "allowNextUnload">;
  registry: Pick<BrowserTabRegistry, "require">;
  liveTabs: ReadonlyMap<string, { host: BrowserHostTabSession }>;
  requireLive(
    tabId: string,
    operation: string,
  ): Effect.Effect<BrowserHostTabSession, BrowserServiceError>;
}) => {
  const runNavigation = (
    tabId: string,
    host: BrowserHostTabSession,
    navigation: BrowserHeldNavigation,
  ): Effect.Effect<unknown, CdpCommandError | BrowserEngineError> =>
    navigation.kind === "url"
      ? host.session.send("Page.navigate", { url: navigation.url })
      : navigation.kind === "reload"
        ? engine.reloadPage(tabId, false)
        : Effect.gen(function* () {
            const history = navigationHistoryResultSchema.parse(
              yield* host.session.send("Page.getNavigationHistory"),
            );
            const target =
              history.entries[history.currentIndex + (navigation.kind === "back" ? -1 : 1)];
            if (target) {
              yield* host.session.send("Page.navigateToHistoryEntry", { entryId: target.id });
            }
            return {};
          });

  const navigate = (
    tabId: string,
    navigation: BrowserNavigation,
  ): Effect.Effect<void, BrowserServiceError> =>
    Effect.gen(function* () {
      yield* registry.require(tabId, "browser.tab.navigate");
      const host = yield* requireLive(tabId, "browser.tab.navigate");
      if (navigation.kind === "stop") {
        yield* host.session
          .send("Page.stopLoading")
          .pipe(Effect.mapError(navigationFailure(tabId)));
        return;
      }
      const held: BrowserHeldNavigation =
        navigation.kind === "address"
          ? {
              kind: "url",
              url: yield* resolveBrowserAddress(navigation.address, "browser.tab.navigate"),
            }
          : { kind: navigation.kind };
      host.noteNavigation(held);
      yield* runNavigation(tabId, host, held).pipe(Effect.mapError(navigationFailure(tabId)));
    });

  const navigationFailure = (tabId: string) => (cause: { readonly message: string }) =>
    new BrowserServiceError({
      code: "browser_action_failed",
      operation: "browser.tab.navigate",
      message: `The tab could not navigate: ${cause.message}`,
      tabId,
      cause,
    });

  /** The navigation that a page held with `beforeunload`. `url` is the one that the engine saw. */
  const heldNavigation = (tabId: string, url: string | null): BrowserHeldNavigation | null =>
    url === null ? (liveTabs.get(tabId)?.host.lastNavigation() ?? null) : { kind: "url", url };

  /** Lets the page unload once, then runs the navigation that it held. */
  const leaveHeldPage = (tabId: string, navigation: BrowserHeldNavigation) =>
    Effect.gen(function* () {
      const host = yield* requireLive(tabId, "browser.navigation.leave_page");
      yield* engine.allowNextUnload(tabId);
      yield* runNavigation(tabId, host, navigation);
    });

  return { navigate, heldNavigation, leaveHeldPage };
};
