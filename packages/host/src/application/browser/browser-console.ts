import type { BrowserConsoleLevel } from "@openducktor/contracts";
import type { CdpEvent } from "../../ports/browser-engine-port";
import {
  consoleApiCalledSchema,
  exceptionThrownSchema,
  logEntryAddedSchema,
  remoteObjectText,
} from "../../ports/browser-cdp-schemas";

const HISTORY_LIMIT = 1_000;
const MAX_ENTRY_TEXT = 8_000;

export type BrowserConsoleEntry = {
  readonly sequence: number;
  readonly level: BrowserConsoleLevel;
  /** True for an uncaught page error. */
  readonly pageError: boolean;
  readonly text: string;
  readonly source: { url: string; line: number; column: number } | null;
};

export type BrowserConsoleBuffer = {
  /** Records one console message or page error. Returns false for other events. */
  capture(event: CdpEvent): boolean;
  read(input: {
    levels: readonly BrowserConsoleLevel[] | null;
    afterSequence: number | null;
    limit: number;
  }): { entries: BrowserConsoleEntry[]; dropped: number; lastSequence: number };
};

/** Keeps the newest console messages and page errors of one tab from the moment it opens. */
export const createBrowserConsoleBuffer = (): BrowserConsoleBuffer => {
  const entries: BrowserConsoleEntry[] = [];
  let nextSequence = 1;
  let dropped = 0;

  const add = (entry: Omit<BrowserConsoleEntry, "sequence">): void => {
    const text =
      entry.text.length > MAX_ENTRY_TEXT ? `${entry.text.slice(0, MAX_ENTRY_TEXT)}…` : entry.text;
    entries.push({ ...entry, text, sequence: nextSequence++ });
    if (entries.length > HISTORY_LIMIT) {
      entries.shift();
      dropped += 1;
    }
  };

  return {
    capture(event) {
      switch (event.method) {
        case "Runtime.consoleAPICalled": {
          const params = consoleApiCalledSchema.parse(event.params);
          const frame = params.stackTrace?.callFrames[0];
          add({
            level: consoleLevelForApiType(params.type),
            pageError: false,
            text: params.args.map(remoteObjectText).join(" "),
            source: frame
              ? { url: frame.url, line: frame.lineNumber + 1, column: frame.columnNumber + 1 }
              : null,
          });
          return true;
        }
        case "Runtime.exceptionThrown": {
          const { exceptionDetails: details } = exceptionThrownSchema.parse(event.params);
          const frame = details.stackTrace?.callFrames[0];
          const url = frame?.url ?? details.url;
          add({
            level: "error",
            pageError: true,
            text: details.exception ? remoteObjectText(details.exception) : details.text,
            source:
              url === undefined
                ? null
                : {
                    url,
                    line: (frame?.lineNumber ?? details.lineNumber) + 1,
                    column: (frame?.columnNumber ?? details.columnNumber) + 1,
                  },
          });
          return true;
        }
        case "Log.entryAdded": {
          const { entry } = logEntryAddedSchema.parse(event.params);
          add({
            level: consoleLevelForLogEntry(entry.level),
            pageError: false,
            text: entry.text,
            source:
              entry.url === undefined
                ? null
                : { url: entry.url, line: (entry.lineNumber ?? 0) + 1, column: 1 },
          });
          return true;
        }
        default:
          return false;
      }
    },
    read({ levels, afterSequence, limit }) {
      const matching = entries.filter(
        (entry) =>
          (afterSequence === null || entry.sequence > afterSequence) &&
          (levels === null || levels.includes(entry.level)),
      );
      return {
        entries: matching.slice(-limit),
        dropped,
        lastSequence: nextSequence - 1,
      };
    },
  };
};

const consoleLevelForApiType = (type: string): BrowserConsoleLevel => {
  switch (type) {
    case "error":
    case "assert":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "debug":
    case "trace":
      return "debug";
    default:
      return "log";
  }
};

const consoleLevelForLogEntry = (
  level: "verbose" | "info" | "warning" | "error",
): BrowserConsoleLevel => (level === "verbose" ? "debug" : level);
