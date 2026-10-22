import { errors } from "playwright-core";
import { BrowserAutomationError } from "../../../ports/browser-automation-port";

/** A ref that the page no longer has. */
export class StaleRefError extends Error {}

/** Maps a Playwright failure to the automation error kinds that the host reports to agents. */
export const toAutomationError = (cause: unknown, action: string): BrowserAutomationError => {
  if (cause instanceof StaleRefError) {
    return new BrowserAutomationError({ kind: "ref_stale", message: cause.message, cause });
  }
  if (cause instanceof errors.TimeoutError) {
    return new BrowserAutomationError({ kind: "timeout", message: `${action} timed out.`, cause });
  }
  const message =
    cause instanceof Error ? (cause.message.split("\n")[0] ?? cause.message) : String(cause);
  return new BrowserAutomationError({
    kind: "failed",
    message: `${action} failed: ${message}`,
    cause,
  });
};
