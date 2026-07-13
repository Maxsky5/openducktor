export type TerminalKeyAction = "copy" | "interrupt" | "paste" | "passthrough";

export const resolveTerminalKeyAction = (
  event: Pick<KeyboardEvent, "ctrlKey" | "key" | "metaKey" | "shiftKey" | "type">,
  isMac: boolean,
  hasSelection: boolean,
): TerminalKeyAction => {
  if (event.type !== "keydown") return "passthrough";
  const key = event.key.toLowerCase();
  const copy =
    (isMac && event.metaKey && key === "c") ||
    (!isMac && event.ctrlKey && event.shiftKey && key === "c") ||
    (!isMac && event.ctrlKey && key === "c" && hasSelection);
  if (copy && hasSelection) return "copy";
  const paste =
    (isMac && event.metaKey && key === "v") ||
    (!isMac && event.ctrlKey && event.shiftKey && key === "v");
  if (paste) return "paste";
  if (event.ctrlKey && key === "c" && !hasSelection) return "interrupt";
  return "passthrough";
};

export const createLatestResizeScheduler = (
  send: (columns: number, rows: number) => void,
  schedule: (callback: () => void) => void = queueMicrotask,
) => {
  let pending: { columns: number; rows: number } | null = null;
  let scheduled = false;
  const flush = (): void => {
    scheduled = false;
    const grid = pending;
    pending = null;
    if (grid) send(grid.columns, grid.rows);
  };
  return {
    flush,
    schedule(columns: number, rows: number): void {
      pending = { columns, rows };
      if (scheduled) return;
      scheduled = true;
      schedule(flush);
    },
  };
};

export const enqueueParsedTerminalWrite = (
  queue: Promise<void>,
  write: (payload: Uint8Array, parsed: () => void) => void,
  payload: Uint8Array,
  parsed: () => void,
): Promise<void> =>
  queue.then(
    () =>
      new Promise<void>((resolve) => {
        write(payload, () => {
          parsed();
          resolve();
        });
      }),
  );
