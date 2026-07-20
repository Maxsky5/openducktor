const TERMINAL_TITLE_SETTLE_MS = 40;

export type TerminalTitleSettlementScheduler = (delayMs: number, settle: () => void) => () => void;

const scheduleTerminalTitleSettlement: TerminalTitleSettlementScheduler = (delayMs, settle) => {
  const timer = setTimeout(settle, delayMs);
  return () => clearTimeout(timer);
};

export type TerminalTitleSettler = {
  offer(title: string): void;
  dispose(): void;
};

export const createTerminalTitleSettler = ({
  onSettledTitle,
  schedule = scheduleTerminalTitleSettlement,
}: {
  onSettledTitle: (title: string) => void;
  schedule?: TerminalTitleSettlementScheduler;
}): TerminalTitleSettler => {
  let cancelPending: (() => void) | null = null;
  let disposed = false;

  return {
    offer(title) {
      if (disposed) return;
      cancelPending?.();
      cancelPending = schedule(TERMINAL_TITLE_SETTLE_MS, () => {
        cancelPending = null;
        if (!disposed) onSettledTitle(title);
      });
    },
    dispose() {
      disposed = true;
      cancelPending?.();
      cancelPending = null;
    },
  };
};
