import type { WorkflowDocument } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";

export type SaveStatus =
  | { readonly status: "saved" }
  | { readonly status: "saving" }
  | { readonly status: "failed"; readonly message: string };

export type DraftAutosave = {
  /**
   * Saves the document after a pause in the edits, so a run of keystrokes makes one save. The
   * status shows Saving from the first edit, so Publish and Discard wait for the save.
   */
  push(document: WorkflowDocument): void;
  /** Starts the save of the waiting document now, such as when the user leaves the editor. */
  flush(): void;
  /** Saves the document of the failed save again. */
  retry(): void;
};

/** The pause after the last edit before the save starts. */
export const AUTOSAVE_DELAY_MS = 400;

/**
 * One save at a time. A change during a save replaces the queued document, so only the newest
 * document saves next. A failed save keeps its document for Retry, unless a newer document waits.
 */
export const createDraftAutosave = ({
  save,
  onStatus,
}: {
  save: (document: WorkflowDocument) => Promise<void>;
  onStatus: (status: SaveStatus) => void;
}): DraftAutosave => {
  let status: SaveStatus["status"] = "saved";
  let running = false;
  let waiting: WorkflowDocument | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let queued: WorkflowDocument | null = null;
  let failed: WorkflowDocument | null = null;

  const report = (next: SaveStatus): void => {
    status = next.status;
    onStatus(next);
  };

  const run = (document: WorkflowDocument): void => {
    running = true;
    failed = null;
    if (status !== "saving") report({ status: "saving" });
    save(document).then(
      () => {
        running = false;
        next({ status: "saved" });
      },
      (cause: unknown) => {
        running = false;
        if (queued === null) failed = document;
        next({ status: "failed", message: errorMessage(cause) });
      },
    );
  };

  const next = (settled: SaveStatus): void => {
    const document = queued;
    queued = null;
    if (document) run(document);
    // A waiting edit keeps Saving until its own save ends.
    else if (waiting === null) report(settled);
  };

  const flush = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const document = waiting;
    waiting = null;
    if (!document) return;
    if (running) queued = document;
    else run(document);
  };

  return {
    push: (document) => {
      waiting = document;
      if (status !== "saving") report({ status: "saving" });
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(flush, AUTOSAVE_DELAY_MS);
    },
    flush,
    retry: () => {
      if (!running && failed) run(failed);
    },
  };
};
