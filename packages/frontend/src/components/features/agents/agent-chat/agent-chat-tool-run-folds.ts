import { useAgentChatSettings } from "./agent-chat-settings-context";
import type { AgentChatThreadModel } from "./agent-chat.types";
import { DEFAULT_CHAT_SETTINGS } from "@openducktor/contracts";
import {
  NO_TOOL_RUNS,
  readToolRunClassifier,
  type ToolRunClassifier,
} from "@openducktor/frontend-core/sessions/transcript/tool-runs";
import { createContext, useSyncExternalStore } from "react";
import type { ToolRunFoldChoice, ToolRunFolds } from "./agent-chat-tool-run-layout";

/**
 * The actions of the tool runs of a transcript. A transcript that follows its end stops following
 * on each action, so the run stays where the reader pressed it. Null where the transcript cannot
 * change its runs, as in the tour.
 */
export type ToolRunActions = {
  /** Folds an open run, or opens a folded run. */
  toggle: (runKey: string, header: HTMLElement, folded: boolean) => void;
  /** Shows earlier calls of a long run, and keeps `keptHidden` of them hidden. */
  showEarlier: (runKey: string, header: HTMLElement, keptHidden: number) => void;
  /** Hides the earlier calls of a long run again, so it shows only its latest calls. */
  hideEarlier: (runKey: string, header: HTMLElement) => void;
};

export const ToolRunActionsContext = createContext<ToolRunActions | null>(null);

/** The folds of the tool runs of one transcript, by the key of the first row of each run. */
export type ToolRunFoldStore = {
  read: () => ToolRunFolds;
  subscribe: (listener: () => void) => () => void;
  choose: (runKey: string, choice: ToolRunFoldChoice) => void;
  showEarlier: (runKey: string, keptHidden: number) => void;
  hideEarlier: (runKey: string) => void;
};

const withoutKey = (map: ReadonlyMap<string, number>, key: string): ReadonlyMap<string, number> => {
  if (!map.has(key)) return map;
  const next = new Map(map);
  next.delete(key);
  return next;
};

export const createToolRunFoldStore = (): ToolRunFoldStore => {
  let folds: ToolRunFolds = { choices: new Map(), keptHidden: new Map() };
  const listeners = new Set<() => void>();
  const update = (next: ToolRunFolds): void => {
    folds = next;
    for (const listener of listeners) listener();
  };
  return {
    read: () => folds,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    choose: (runKey, choice) => {
      const choices = new Map(folds.choices).set(runKey, choice);
      // A long run shows its latest calls again when the reader opens it again.
      const keptHidden =
        choice === "folded" ? withoutKey(folds.keptHidden, runKey) : folds.keptHidden;
      update({ choices, keptHidden });
    },
    showEarlier: (runKey, keptHidden) => {
      update({
        choices: folds.choices,
        keptHidden: new Map(folds.keptHidden).set(runKey, keptHidden),
      });
    },
    hideEarlier: (runKey) => {
      update({ choices: folds.choices, keptHidden: withoutKey(folds.keptHidden, runKey) });
    },
  };
};

export const useToolRunFolds = (store: ToolRunFoldStore): ToolRunFolds =>
  useSyncExternalStore(store.subscribe, store.read, store.read);

/**
 * The classifier of the tool runs of a transcript. With the `groupToolCalls` chat setting off,
 * each call shows as its own tool row.
 */
export const useToolRunClassifier = (
  runtimePresentation: AgentChatThreadModel["runtimePresentation"],
): ToolRunClassifier => {
  const groupToolCalls =
    useAgentChatSettings()?.groupToolCalls ?? DEFAULT_CHAT_SETTINGS.groupToolCalls;
  return groupToolCalls ? readToolRunClassifier(runtimePresentation.presentToolCall) : NO_TOOL_RUNS;
};

/**
 * Whether a tool run folds once its calls all ended and another row follows it. The
 * `collapseFinishedToolCalls` chat setting turns it off.
 */
export const useCollapseFinishedToolRuns = (): boolean =>
  useAgentChatSettings()?.collapseFinishedToolCalls ??
  DEFAULT_CHAT_SETTINGS.collapseFinishedToolCalls;
