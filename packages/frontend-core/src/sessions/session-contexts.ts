import { type Context, createContext, use } from "react";
import type {
  AgentOperationsContextValue,
  AgentSessionHistoryLoadContextValue,
  AgentSessionReadModelStateContextValue,
  HostRuntimeStatusContextValue,
} from "../types/session-slices";
import type { AgentMessageQueuesStore } from "./agent-message-queues-store";
import type { AgentSessionsStore } from "./agent-sessions-store";

export const HostRuntimeStatusContext = createContext<HostRuntimeStatusContextValue | null>(null);
export const AgentSessionsContext = createContext<AgentSessionsStore | null>(null);
export const AgentMessageQueuesContext = createContext<AgentMessageQueuesStore | null>(null);
export const AgentOperationsContext = createContext<AgentOperationsContextValue | null>(null);
export const AgentSessionHistoryLoadContext =
  createContext<AgentSessionHistoryLoadContextValue | null>(null);
export const AgentSessionReadModelStateContext =
  createContext<AgentSessionReadModelStateContextValue | null>(null);

const useSessionContext = <T>(context: Context<T | null>, name: string): T => {
  const value = use(context);
  if (!value) {
    throw new Error(`${name} must be used inside the session state providers.`);
  }
  return value;
};

export const useHostRuntimeStatusContext = (): HostRuntimeStatusContextValue =>
  useSessionContext(HostRuntimeStatusContext, "useHostRuntimeStatusContext");

export const useAgentSessionsContext = (): AgentSessionsStore =>
  useSessionContext(AgentSessionsContext, "useAgentSessions");

export const useAgentMessageQueuesContext = (): AgentMessageQueuesStore =>
  useSessionContext(AgentMessageQueuesContext, "useAgentMessageQueue");

export const useAgentOperationsContext = (): AgentOperationsContextValue =>
  useSessionContext(AgentOperationsContext, "useAgentOperations");

export const useAgentSessionHistoryLoadContext = (): AgentSessionHistoryLoadContextValue =>
  useSessionContext(AgentSessionHistoryLoadContext, "useAgentSessionHistoryLoadContext");

export const useAgentSessionReadModelStateContext = (): AgentSessionReadModelStateContextValue =>
  useSessionContext(AgentSessionReadModelStateContext, "useAgentSessionReadModelState");
