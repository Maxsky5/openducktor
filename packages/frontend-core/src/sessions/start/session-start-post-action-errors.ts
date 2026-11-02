import type { SessionStartPostAction } from "./session-start-workflow";

export const sessionStartPostActionErrorTitle = (action: SessionStartPostAction): string => {
  return action === "kickoff"
    ? "The session started, but its first message could not be sent."
    : "Session started, but feedback message failed.";
};
