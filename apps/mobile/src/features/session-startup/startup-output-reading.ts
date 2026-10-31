import type {
  TerminalPageInbound,
  TerminalPageOutbound,
} from "@/rich-content/isolated-page/terminal-page-messages";

export type StartupOutputReading = {
  viewport?: { row: number; follow: boolean };
  text: string | null;
  textOffset: number;
};

/** Ignore replay scroll events until the page restores the saved position. */
export const createStartupOutputReader = ({
  reading,
  post,
  onText,
}: {
  reading: StartupOutputReading;
  post: (message: TerminalPageInbound) => void;
  onText: (text: string) => void;
}) => {
  let viewportReady = false;
  return {
    reset(): void {
      viewportReady = false;
    },
    receive(message: TerminalPageOutbound): boolean {
      if (message.type === "terminal_hydrated") {
        if (reading.viewport) post({ type: "terminal_set_viewport", ...reading.viewport });
        else viewportReady = true;
        return true;
      }
      if (message.type === "terminal_viewport") {
        if (message.restored) viewportReady = true;
        if (viewportReady) reading.viewport = { row: message.row, follow: message.follow };
        return true;
      }
      if (message.type === "terminal_output_text") {
        reading.text = message.text;
        onText(message.text);
        return true;
      }
      return false;
    },
  };
};
