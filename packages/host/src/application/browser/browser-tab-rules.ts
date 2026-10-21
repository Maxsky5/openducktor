import {
  type BrowserEngineState,
  browserEngineNotReadyMessage,
  parseBrowserAddress,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { BrowserServiceError } from "./browser-service-error";

/** Fails unless the engine can open tabs now. */
export const requireBrowserEngineReady = (
  state: BrowserEngineState,
  operation: string,
): Effect.Effect<void, BrowserServiceError> => {
  const message = browserEngineNotReadyMessage(state);
  if (message === null) return Effect.void;
  return Effect.fail(
    new BrowserServiceError({
      code: state.kind === "no_window" ? "browser_no_window" : "browser_not_ready",
      operation,
      message,
    }),
  );
};

/** Turns address bar text into a URL that a tab may load. */
export const resolveBrowserAddress = (
  address: string,
  operation: string,
): Effect.Effect<string, BrowserServiceError> => {
  const result = parseBrowserAddress(address);
  if (result.ok) {
    return Effect.succeed(result.url);
  }
  if (result.reason === "scheme") {
    return Effect.fail(
      new BrowserServiceError({
        code: "browser_scheme_refused",
        operation,
        message: `Browser tabs load only http and https pages, not ${result.scheme}: addresses.`,
      }),
    );
  }
  return Effect.fail(
    new BrowserServiceError({
      code: "browser_invalid_address",
      operation,
      message: `"${address}" is not a web address.`,
    }),
  );
};
