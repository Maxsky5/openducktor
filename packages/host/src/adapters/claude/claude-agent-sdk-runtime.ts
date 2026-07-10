import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import type { CreateClaudeAgentSdkServiceInput } from "./claude-agent-sdk-types";
import { resolveClaudeCodeExecutablePath } from "./claude-code-executable";

export const ensureClaudeWorkspaceRuntime = (
  input: CreateClaudeAgentSdkServiceInput,
  repoPath: string,
) =>
  input.runtimeRegistry
    .ensureWorkspaceRuntime({
      runtimeKind: "claude",
      repoPath,
      workingDirectory: repoPath,
      descriptor: CLAUDE_RUNTIME_DESCRIPTOR,
    })
    .pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "claudeRuntime.ensureWorkspaceRuntime", { repoPath }),
      ),
    );

export const resolveClaudeExecutable = (
  input: CreateClaudeAgentSdkServiceInput,
  operation: string,
) =>
  resolveClaudeCodeExecutablePath(input.toolDiscovery).pipe(
    Effect.mapError((cause) => toHostOperationError(cause, operation)),
  );

export const requireLiveClaudeWorkspaceRuntime = (
  serviceInput: CreateClaudeAgentSdkServiceInput,
  input: { repoPath: string; runtimeKind: string },
) =>
  Effect.gen(function* () {
    const runtime = yield* serviceInput.runtimeRegistry
      .findWorkspaceRuntime({
        repoPath: input.repoPath,
        runtimeKind: input.runtimeKind,
      })
      .pipe(
        Effect.mapError((cause) =>
          toHostOperationError(cause, "claudeRuntime.findWorkspaceRuntime", {
            repoPath: input.repoPath,
            runtimeKind: input.runtimeKind,
          }),
        ),
      );
    if (!runtime) {
      return yield* Effect.fail(
        new HostValidationError({
          field: "runtimeKind",
          message: `No live Claude workspace runtime found for repo '${input.repoPath}'.`,
          details: { repoPath: input.repoPath, runtimeKind: input.runtimeKind },
        }),
      );
    }
    return runtime;
  });
