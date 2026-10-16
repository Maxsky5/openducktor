import type { GitChangeIntent } from "../contracts";

/** Identifies one change request, so its control can show that it is pending. */
export const gitChangeIntentKey = (intent: GitChangeIntent): string =>
  JSON.stringify([intent.action, intent.group, intent.selection]);
