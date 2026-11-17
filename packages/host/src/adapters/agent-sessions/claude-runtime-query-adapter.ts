import { Effect } from "effect";
import type {
  ClaudeAgentSdkService,
  ClaudeAgentSdkServiceError,
} from "../../application/runtimes/claude-agent-sdk-service";
import type { RuntimeQueryIdentity } from "../../ports/runtime-query-error";
import type {
  AgentRuntimeQueryAdapterPort,
  NativeAgentRuntimeQueries,
} from "../../ports/agent-runtime-query-port";
import { toRuntimeQueryError } from "./runtime-query-adapter";

export const createClaudeRuntimeQueryAdapter = (
  service: Pick<
    ClaudeAgentSdkService,
    keyof NativeAgentRuntimeQueries | "resolveSessionParent" | "readLatestUsageLimitStop"
  >,
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
  return {
    resolveSessionParent: (input) =>
      read("read session parent", input, () => service.resolveSessionParent(input)),
    loadRuntimeCatalog: (input) =>
      read("load runtime catalog", input, () => service.loadRuntimeCatalog(input)),
    searchFiles: (input) => read("search files", input, () => service.searchFiles(input)),
    loadSessionHistory: (input) =>
      read("load session history", input, () => service.loadSessionHistory(input)),
    loadSessionTodos: (input) =>
      read("load session todos", input, () => service.loadSessionTodos(input)),
    loadSessionDiff: (input) =>
      read("load session diff", input, () => service.loadSessionDiff(input)),
    loadFileStatus: (input) => read("load file status", input, () => service.loadFileStatus(input)),
    readLatestUsageLimitStop: (input) =>
      read("read latest usage limit stop", input, () => service.readLatestUsageLimitStop(input)),
    // Claude reports the exact reset time of the stopped turn, and the resume waits until then.
    readUsageLimitRecovery: () => Effect.succeed({ kind: "recovered" }),
  };
};
