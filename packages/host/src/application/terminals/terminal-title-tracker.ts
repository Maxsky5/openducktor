import { createTerminalTitleParser } from "./terminal-title-parser";
import {
  createTerminalTitleSettler,
  type TerminalTitleSettlementScheduler,
} from "./terminal-title-settler";

export type TerminalTitleTracker = {
  consume(data: Uint8Array): void;
  dispose(): void;
};

export const createTerminalTitleTracker = (
  onSettledTitle: (title: string) => void,
  schedule?: TerminalTitleSettlementScheduler,
): TerminalTitleTracker => {
  const parser = createTerminalTitleParser();
  const settler = createTerminalTitleSettler({
    onSettledTitle,
    ...(schedule ? { schedule } : {}),
  });
  let disposed = false;

  return {
    consume(data) {
      if (disposed) return;
      const title = parser.consume(data);
      if (title) settler.offer(title);
    },
    dispose() {
      disposed = true;
      settler.dispose();
    },
  };
};
