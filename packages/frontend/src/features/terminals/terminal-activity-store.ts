import type {
  TerminalActivity,
  TerminalActivityMessage,
  TerminalContext,
} from "@openducktor/contracts";
import { replaceEqualDeep } from "@tanstack/react-query";

export type TerminalActivityState = {
  status: "loading" | "ready" | "unavailable";
  commands: readonly TerminalActivity[];
  error: string | null;
};

const EMPTY_COMMANDS: readonly TerminalActivity[] = [];
export const EMPTY_TERMINAL_ACTIVITY: TerminalActivityState = {
  status: "loading",
  commands: EMPTY_COMMANDS,
  error: null,
};

export const terminalActivityOwnerKey = (context: TerminalContext): string => {
  if ("taskId" in context) return JSON.stringify(["task", context.repoPath, context.taskId]);
  if ("kind" in context)
    return JSON.stringify([
      "workspace_session",
      context.repoPath,
      context.workspaceId,
      context.sessionId,
    ]);
  return "unassociated";
};

/** Keep each owner's snapshot stable so another task's command does not render its cards. */
export const createTerminalActivityStore = () => {
  const listeners = new Set<() => void>();
  const cache = new Map<string, TerminalActivityState>();
  let records = new Map<string, TerminalActivity>();
  let pending: Map<string, TerminalActivity> | null = null;
  let groups = new Map<string, readonly TerminalActivity[]>();
  let status: TerminalActivityState["status"] = "loading";
  let error: string | null = null;
  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const groupRecords = (): void => {
    const next = new Map<string, TerminalActivity[]>();
    for (const record of records.values()) {
      const key = terminalActivityOwnerKey(record.summary.context);
      const commands = next.get(key) ?? [];
      commands.push(record);
      next.set(key, commands);
    }
    groups = new Map(
      Array.from(next, ([key, commands]) => [key, replaceEqualDeep(groups.get(key), commands)]),
    );
  };
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    read(ownerKey: string): TerminalActivityState {
      const commands = groups.get(ownerKey) ?? EMPTY_COMMANDS;
      const previous = cache.get(ownerKey);
      if (previous?.status === status && previous.commands === commands && previous.error === error)
        return previous;
      const state = { status, commands, error };
      cache.set(ownerKey, state);
      return state;
    },
    loading(): void {
      pending = null;
      status = "loading";
      error = null;
      emit();
    },
    apply(message: TerminalActivityMessage): void {
      if (message.type === "activity_snapshot_start") {
        pending = new Map();
        return;
      }
      if (message.type === "activity_snapshot_end") {
        if (pending === null) return;
        records = pending;
        pending = null;
        status = "ready";
        error = null;
      } else {
        const target = pending ?? records;
        if (message.type === "activity_updated")
          target.set(message.activity.summary.terminalId, message.activity);
        else if (!target.delete(message.terminalId)) return;
        if (pending !== null) return;
      }
      groupRecords();
      emit();
    },
    disconnected(reason = "Terminal connection lost. Reconnecting…"): void {
      pending = null;
      status = "unavailable";
      error = reason;
      emit();
    },
    clear(): void {
      records.clear();
      pending = null;
      groups.clear();
      cache.clear();
      status = "loading";
      error = null;
      emit();
      listeners.clear();
    },
  };
};
