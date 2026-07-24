import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";
import { resolveClaudeCodeExecutablePath } from "./claude-code-executable";

export const resolveClaudeExecutable = (
  input: CreateClaudeAgentSdkServiceInput,
  operation: string,
) =>
  resolveClaudeCodeExecutablePath(input.toolDiscovery).pipe(
    Effect.mapError((cause) => toHostOperationError(cause, operation)),
  );
