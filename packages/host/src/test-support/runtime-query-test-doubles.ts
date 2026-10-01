import { Effect } from "effect";
import type {
  AgentRuntimeQueryAdapterPort,
  NativeAgentRuntimeQueries,
} from "../ports/agent-runtime-query-port";

export const unexpectedRuntimeQueries = {
  resolveSessionParent: () => Effect.die(new Error("Unexpected query: resolveSessionParent")),
  loadRuntimeCatalog: () => Effect.die(new Error("Unexpected query: loadRuntimeCatalog")),
  searchFiles: () => Effect.die(new Error("Unexpected query: searchFiles")),
  loadSessionHistory: () => Effect.die(new Error("Unexpected query: loadSessionHistory")),
  loadSessionTodos: () => Effect.die(new Error("Unexpected query: loadSessionTodos")),
  loadSessionDiff: () => Effect.die(new Error("Unexpected query: loadSessionDiff")),
  loadSessionMetadata: () => Effect.die(new Error("Unexpected query: loadSessionMetadata")),
  loadFileStatus: () => Effect.die(new Error("Unexpected query: loadFileStatus")),
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
  loadSessionMetadata: async () => {
    throw new Error("Unexpected query: loadSessionMetadata");
  },
  loadFileStatus: async () => {
    throw new Error("Unexpected query: loadFileStatus");
  },
} satisfies NativeAgentRuntimeQueries & import("@openducktor/core").AgentSessionQueryParentPort;
