import type { AgentRuntimeCatalogRead, LoadAgentRuntimeCatalogInput } from "@openducktor/core";
import { Effect } from "effect";
import type {
  ClaudeAgentSdkService,
  ClaudeAgentSdkServiceError,
} from "../../application/runtimes/claude-agent-sdk-service";
import type { RuntimeQueryError, RuntimeQueryIdentity } from "../../ports/runtime-query-error";
import { createKeyedSharedFlight } from "../../effect/shared-flight";
import type {
  AgentRuntimeQueryAdapterPort,
  NativeAgentRuntimeQueries,
} from "../../ports/agent-runtime-query-port";
import { toRuntimeQueryError } from "./runtime-query-adapter";

/** Create one adapter for each runtime start, so a new runtime never reuses old catalogs. */
export const createClaudeRuntimeQueryAdapter = (
  service: Pick<ClaudeAgentSdkService, keyof NativeAgentRuntimeQueries | "resolveSessionParent">,
): AgentRuntimeQueryAdapterPort => {
  const read = <Result>(
    operation: string,
    input: RuntimeQueryIdentity,
    run: () => Effect.Effect<Result, ClaudeAgentSdkServiceError>,
  ) =>
    Effect.try({ try: run, catch: (cause) => toRuntimeQueryError(operation, input, cause) }).pipe(
      Effect.flatMap((effect) =>
        effect.pipe(Effect.mapError((cause) => toRuntimeQueryError(operation, input, cause))),
      ),
    );
  // Each catalog read starts a Claude Code process, so validation reuses the last read of each
  // directory that returned models.
  const knownCatalogs = new Map<string, AgentRuntimeCatalogRead>();
  const catalogReads = createKeyedSharedFlight<
    string,
    AgentRuntimeCatalogRead,
    RuntimeQueryError
  >();
  const readCatalog = (input: LoadAgentRuntimeCatalogInput) =>
    catalogReads.run(
      input.workingDirectory,
      read("load runtime catalog", input, () => service.loadRuntimeCatalog(input)),
    );
  return {
    resolveSessionParent: (input) =>
      read("read session parent", input, () => service.resolveSessionParent(input)),
    loadRuntimeCatalog: (input) =>
      readCatalog(input).pipe(
        Effect.tap((catalog) =>
          Effect.sync(() => {
            if (catalog.models?.status !== "available") return;
            // Claude can change its model list without a runtime restart, so the other
            // directories read Claude again.
            knownCatalogs.clear();
            knownCatalogs.set(input.workingDirectory, catalog);
          }),
        ),
      ),
    loadKnownRuntimeCatalog: (input) =>
      Effect.suspend(() => {
        const known = knownCatalogs.get(input.workingDirectory);
        if (known) return Effect.succeed(known);
        return readCatalog(input).pipe(
          Effect.tap((catalog) =>
            Effect.sync(() => {
              if (catalog.models?.status === "available") {
                knownCatalogs.set(input.workingDirectory, catalog);
              }
            }),
          ),
        );
      }),
    searchFiles: (input) => read("search files", input, () => service.searchFiles(input)),
    loadSessionHistory: (input) =>
      read("load session history", input, () => service.loadSessionHistory(input)),
    loadSessionTodos: (input) =>
      read("load session todos", input, () => service.loadSessionTodos(input)),
    loadSessionDiff: (input) =>
      read("load session diff", input, () => service.loadSessionDiff(input)),
    loadFileStatus: (input) => read("load file status", input, () => service.loadFileStatus(input)),
  };
};
