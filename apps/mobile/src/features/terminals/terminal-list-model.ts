import type { TerminalLifecycle, TerminalSummary } from "@openducktor/contracts";
import {
  canRetryTerminalCreation,
  type TerminalTab,
  terminalTabLabel,
} from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import { terminalTabLifecycleText } from "@openducktor/frontend-core/terminals/terminal-tab-presentation";
import { terminalExitNotice } from "@openducktor/frontend-core/terminals/terminal-viewport-policy";
import {
  MAX_SCOPE_TERMINALS,
  type TerminalSessionsModel,
} from "@openducktor/frontend-core/terminals/use-terminals";
import type { Tone } from "@/ui/tones";

export type TerminalRow = {
  tabId: string;
  /** The host terminal that opens from this row, or null for a start or a lost terminal. */
  terminalId: string | null;
  title: string;
  /**
   * Who started the terminal and when, or null before the host started it. Terminals of one folder
   * have the same title, so the start time tells them apart.
   */
  startedLabel: string | null;
  stateLabel: string;
  stateTone: Tone;
  /** The start failure, the lost reason, or the exit status. */
  detail: string | null;
  detailIsFailure: boolean;
  /** The live activity stream reports a running command. */
  runsCommand: boolean;
  closing: boolean;
  /** The start can run again. A start with a lost result cannot, because it may have run. */
  canRetry: boolean;
  /** The host result of the start was lost. */
  outcomeUnknown: boolean;
};

const LIFECYCLE_TONES = {
  starting: "pending",
  running: "running",
  closing: "pending",
  close_failed: "destructive",
  exited: "neutral",
} as const satisfies Record<TerminalLifecycle, Tone>;

const STARTED_BY_LABELS = { user: "Started by you", host: "Started by OpenDucktor" } as const;
// Seconds tell apart terminals that started in the same minute.
const START_TIME = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const startedLabel = (summary: TerminalSummary): string => {
  const startedAt = new Date(summary.createdAt);
  const startedBy = STARTED_BY_LABELS[summary.startedBy];
  return Number.isNaN(startedAt.getTime())
    ? startedBy
    : `${startedBy} at ${START_TIME.format(startedAt)}`;
};

const PENDING_TONES = {
  creating: "pending",
  creation_failed: "destructive",
  unsupported_runtime: "warning",
  lost: "warning",
} as const satisfies Record<Exclude<TerminalTab["requestState"], "ready">, Tone>;

const rowTone = (tab: TerminalTab): Tone => {
  if (tab.requestState !== "ready") return PENDING_TONES[tab.requestState];
  const exit = tabExitNotice(tab);
  if (exit) return exit.isFailure ? "warning" : "neutral";
  return LIFECYCLE_TONES[tab.summary.lifecycle];
};

/** The exit status of an exited terminal from its host summary. */
export const tabExitNotice = (tab: TerminalTab) =>
  tab.requestState === "ready" && tab.summary.lifecycle === "exited" && tab.summary.exit
    ? terminalExitNotice(tab.summary.exit.exitCode, tab.summary.exit.signal)
    : null;

const toTerminalRow = (tab: TerminalTab, closing: boolean, runsCommand: boolean): TerminalRow => {
  const exit = tabExitNotice(tab);
  return {
    tabId: tab.tabId,
    terminalId: tab.terminalId,
    title: terminalTabLabel(tab),
    startedLabel: tab.requestState === "ready" ? startedLabel(tab.summary) : null,
    stateLabel: closing ? "Closing" : terminalTabLifecycleText(tab),
    stateTone: closing ? "pending" : rowTone(tab),
    detail: tab.error ?? exit?.text ?? null,
    detailIsFailure: tab.error !== null || (exit?.isFailure ?? false),
    runsCommand,
    closing,
    canRetry: canRetryTerminalCreation(tab),
    outcomeUnknown:
      tab.requestState !== "ready" && tab.requestState !== "lost" && tab.outcomeUnknown,
  };
};

/** The rows of the Terminals view, in host order with new starts last. */
export const buildTerminalRows = (
  model: Pick<TerminalSessionsModel, "tabs" | "closingTabIds" | "runningCommandTerminalIds">,
): TerminalRow[] =>
  model.tabs.map((tab) =>
    toTerminalRow(
      tab,
      model.closingTabIds.has(tab.tabId),
      tab.terminalId !== null && model.runningCommandTerminalIds.has(tab.terminalId),
    ),
  );

/** The use of the terminal limit, such as "3 of 8 terminals". Closing terminals do not count. */
export const terminalLimitText = (
  model: Pick<TerminalSessionsModel, "tabs" | "closingTabIds">,
): string => {
  const open = model.tabs.filter((tab) => !model.closingTabIds.has(tab.tabId)).length;
  return `${open} of ${MAX_SCOPE_TERMINALS} terminals`;
};

/** The terminal tab of a host terminal ID, also after the terminal was lost. */
export const findTerminalTab = (
  tabs: readonly TerminalTab[],
  terminalId: string,
): TerminalTab | null =>
  tabs.find(
    (tab) =>
      tab.terminalId === terminalId ||
      (tab.requestState === "lost" && tab.sourceTerminalId === terminalId),
  ) ?? null;

export type TerminalScreenStatus =
  | { kind: "loading" }
  | { kind: "unavailable"; message: string }
  | { kind: "discovery_failed"; message: string }
  | { kind: "missing" }
  | { kind: "lost"; tab: Extract<TerminalTab, { requestState: "lost" }> }
  | { kind: "ready"; tab: Extract<TerminalTab, { requestState: "ready" }> };

/** What the Terminal screen shows for `terminalId`. */
export const terminalScreenStatus = (
  model: Pick<
    TerminalSessionsModel,
    "isAvailable" | "startBlockedReason" | "tabs" | "isSynced" | "isLoading" | "discoveryError"
  >,
  terminalId: string,
): TerminalScreenStatus => {
  if (!model.isAvailable) {
    return {
      kind: "unavailable",
      message: model.startBlockedReason ?? "Terminals are unavailable.",
    };
  }
  const tab = findTerminalTab(model.tabs, terminalId);
  if (tab?.requestState === "ready") return { kind: "ready", tab };
  if (tab?.requestState === "lost") return { kind: "lost", tab };
  if (model.discoveryError !== null)
    return { kind: "discovery_failed", message: model.discoveryError };
  if (!model.isSynced || model.isLoading) return { kind: "loading" };
  return { kind: "missing" };
};
