import { Effect } from "effect";
import type {
  AgentRuntimeQueryAdapterPort,
  NativeAgentRuntimeQueries,
} from "../ports/agent-runtime-query-port";

export const unexpectedRuntimeQueries = {
  resolveSessionParent: () => Effect.dieMessage("Unexpected query: resolveSessionParent"),
  loadRuntimeCatalog: () => Effect.dieMessage("Unexpected query: loadRuntimeCatalog"),
  searchFiles: () => Effect.dieMessage("Unexpected query: searchFiles"),
  loadSessionHistory: () => Effect.dieMessage("Unexpected query: loadSessionHistory"),
  loadSessionTodos: () => Effect.dieMessage("Unexpected query: loadSessionTodos"),
  loadSessionDiff: () => Effect.dieMessage("Unexpected query: loadSessionDiff"),
  loadFileStatus: () => Effect.dieMessage("Unexpected query: loadFileStatus"),
} satisfies AgentRuntimeQueryAdapterPort;

export const unexpectedNativeRuntimeQueries = {
  resolveSessionParent: async () => {
    throw new Error("Unexpected query: resolveSessionParent");
  },
  loadRuntimeCatalog: async () => {
    throw new Error("Unexpected query: loadRuntimeCatalog");
  },
  searchFiles: async () => {
    throw new Error("Unexpected query: searchFiles");
  },
  loadSessionHistory: async () => {
    throw new Error("Unexpected query: loadSessionHistory");
  },
  loadSessionTodos: async () => {
    throw new Error("Unexpected query: loadSessionTodos");
  },
  loadSessionDiff: async () => {
    throw new Error("Unexpected query: loadSessionDiff");
  },
  loadFileStatus: async () => {
    throw new Error("Unexpected query: loadFileStatus");
  },
} satisfies NativeAgentRuntimeQueries & import("@openducktor/core").AgentSessionQueryParentPort;
