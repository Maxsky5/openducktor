import type { BrowserTabFrameStateRequest } from "@openducktor/contracts";
import { Effect } from "effect";
import type { SerialGate } from "../../effect/serial-gate";
import { BrowserServiceError } from "./browser-service-error";
import type { BrowserTabRegistry } from "./browser-tab-registry";

/**
 * The tab operations of frame tabs: user tabs that a web runner app on the host machine shows in
 * iframes of its own browser. Such a tab has no host page, so the client reports its page state.
 */
export const createBrowserFrameTabs = ({
  gate,
  registry,
}: {
  /** The gate of the tab service, so frame operations keep their order with other tab work. */
  gate: SerialGate;
  registry: BrowserTabRegistry;
}) => {
  /**
   * Takes the page state of a tab that a client shows in a frame. A tab with a host page gets its
   * state from the engine, so it refuses the report.
   */
  const reportFrameState = (
    request: BrowserTabFrameStateRequest,
  ): Effect.Effect<void, BrowserServiceError> =>
    gate.run(
      request.tabId,
      Effect.gen(function* () {
        const operation = "browser.tab.frame_state";
        const record = yield* registry.require(request.tabId, operation);
        if (record.summary.page !== "frame") {
          return yield* new BrowserServiceError({
            code: "browser_invalid_input",
            operation,
            message: "This tab has a page on the host, so it takes no frame state.",
            tabId: request.tabId,
          });
        }
        const { tabId: _tabId, ...state } = request;
        registry.update(request.tabId, (summary) => ({ ...summary, ...state }));
      }),
    );

  return { reportFrameState };
};
