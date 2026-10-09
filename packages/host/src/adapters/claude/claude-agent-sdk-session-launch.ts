import { Effect } from "effect";
import { speedEligibility } from "@openducktor/core";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { HostValidationError, toHostOperationError } from "../../effect/host-errors";
import { resolveOpenDucktorMcpCommand } from "../mcp/openducktor-mcp-command";
import { loadClaudeTodos } from "./claude-agent-sdk-todos";
import {
  createClaudeAgentSdkSession,
  type CreateClaudeAgentSdkSessionInput,
} from "./claude-agent-sdk-session-factory";
import { fromPromise } from "./claude-agent-sdk-utils";
import type { ClaudeSessionLaunchInput } from "./claude-agent-sdk-session-policy";
import type {
  ClaudeSessionInput,
  CreateClaudeAgentSdkServiceInput,
  ClaudeSessionStore,
  ClaudeAgentSdkEventEmitter,
  ClaudeAgentSdkService,
} from "./claude-agent-sdk-types";
import type { ClaudeWorkspaceFileSearch } from "./claude-agent-sdk-file-search";

export const launchClaudeSession = (
  input: ClaudeSessionInput,
  runtimeId: string,
  sessionInput: ClaudeSessionLaunchInput,
  onContinuationAdmission: (() => void) | undefined,
  context: {
    loadRuntimeCatalog: ClaudeAgentSdkService["loadRuntimeCatalog"];
    serviceInput: CreateClaudeAgentSdkServiceInput;
    fileSearch: ClaudeWorkspaceFileSearch;
    now: () => string;
    randomId: () => string;
    sessionStore: ClaudeSessionStore;
    emit: ClaudeAgentSdkEventEmitter;
    recordSpeedChoice: Parameters<ClaudeAgentSdkService["setSpeedChoiceRecorder"]>[0] | undefined;
  },
) => {
  return Effect.gen(function* () {
    if (input.speed === null && sessionInput.resumeInterruptedTurn === true)
      return yield* new HostValidationError({
        field: "speed",
        message: "The native speed choice is unknown. Set fast mode before continuing work.",
      });
    const isNew = !sessionInput.options.resume || sessionInput.options.forkSession === true;
    if (input.speed === "fast") {
      const catalog = yield* context.loadRuntimeCatalog({
        repoPath: input.repoPath,
        runtimeKind: "claude",
        workingDirectory: input.workingDirectory,
      });
      if (catalog.models?.status !== "available")
        return yield* new HostValidationError({
          field: "speed",
          message: "Claude model eligibility could not be read. Check authentication and retry.",
          cause: catalog.models?.status === "failed" ? catalog.models.cause : undefined,
        });
      if (
        speedEligibility(CLAUDE_RUNTIME_DESCRIPTOR, catalog.models.catalog, input.model) !==
        "supported"
      )
        return yield* new HostValidationError({
          field: "speed",
          message: "The selected Claude model does not report speed support.",
        });
    }
    const claudePolicy = isNew
      ? yield* context.serviceInput.launchPolicy.resolve({
          role: input.sessionScope.kind === "workflow" ? input.sessionScope.role : null,
        })
      : null;
    const launchSessionInput = { ...sessionInput, claudePolicy };
    const resumeSessionId = sessionInput.options.resume;
    const initialTodos = resumeSessionId
      ? yield* fromPromise("claudeRuntime.loadSessionTodos", () =>
          loadClaudeTodos({
            ...input,
            externalSessionId: resumeSessionId,
          }),
        )
      : [];
    const mcpCommand = yield* resolveOpenDucktorMcpCommand({
      runtimeDistribution: context.serviceInput.runtimeDistribution,
      toolDiscovery: context.serviceInput.toolDiscovery,
    }).pipe(
      Effect.mapError((cause) =>
        toHostOperationError(cause, "claudeRuntime.resolveMcpCommand", {
          repoPath: input.repoPath,
        }),
      ),
    );
    const mcpBridgeConnection = yield* context.serviceInput.resolveMcpBridgeConnection(
      input.repoPath,
    );
    yield* fromPromise("claudeRuntime.prewarmFileSearch", async () => {
      context.fileSearch.prewarm(input.workingDirectory);
    });
    const createSessionInput: CreateClaudeAgentSdkSessionInput = {
      recordSpeedChoice: (ref, choice, isCurrent, model, previousChoice) => {
        if (!context.recordSpeedChoice)
          throw new HostValidationError({
            field: "speed",
            message: "Fast-mode persistence is not configured.",
          });
        return context.recordSpeedChoice(ref, choice, isCurrent, model, previousChoice);
      },
      emit: context.emit,
      initialTodos,
      input,
      now: context.now,
      randomId: context.randomId,
      resolvedDependencies: {
        claudeExecutablePath: context.serviceInput.claudeExecutablePath,
        mcpBridgeConnection,
        mcpCommand,
      },
      runtimeId,
      serviceInput: context.serviceInput,
      sessionInput: launchSessionInput,
      sessionStore: context.sessionStore,
    };
    if (onContinuationAdmission) {
      createSessionInput.onContinuationAdmission = onContinuationAdmission;
    }
    return yield* fromPromise("claudeRuntime.createSession", () =>
      createClaudeAgentSdkSession(createSessionInput),
    );
  });
};
