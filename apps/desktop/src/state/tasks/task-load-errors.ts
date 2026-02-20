import { errorMessage } from "@/lib/errors";

const TASK_STORE_HINT =
  "OpenDucktor uses centralized Beads at ~/.openducktor/beads/<repo-id>/.beads. Initialization is automatic on repo open; retry if this is the first load.";

export const summarizeTaskLoadError = (error: unknown): string => {
  const message = (errorMessage(error).split("\n").at(0) ?? "Unknown error").trim();
  const beadsFailure = /beads|beads_dir|\bbd\b|task store/i.test(message);
  if (beadsFailure) {
    return `Task store unavailable. ${message} ${TASK_STORE_HINT}`;
  }

  return `Task store unavailable. ${message}`;
};
