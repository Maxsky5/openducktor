import type { SessionStartPostAction } from "./session-start-workflow";

export const sessionStartPostActionErrorTitle = (action: SessionStartPostAction): string => {
  return action === "kickoff"
    ? "Session started, but the kickoff prompt failed to send."
    : "Session started, but feedback message failed.";
};
