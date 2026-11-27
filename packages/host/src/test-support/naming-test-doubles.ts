import {
  agentJsonAnswerMismatch,
  agentJsonOutputSchema,
  type AgentJsonGenerationInput,
  type AgentJsonOutputSchema,
  type AgentTextGenerationInput,
  type JsonValue,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { WorkspaceSessionNamingDependencies } from "../application/workspaces/workspace-session-naming";
import { createNamingService, type NamingService } from "../application/naming/naming-service";
import { createDefaultGlobalConfig } from "../config/global-config";
import { HostOperationError, type HostError } from "../effect/host-errors";
import { unexpectedEffectCall } from "./service-test-doubles";

/** A naming service for a workspace without a naming model: it never calls a model. */
export const disabledNamingService: NamingService = {
  generate: () => Effect.succeed({ status: "disabled" } as const),
};

/** A model request as a test reads it, with the JSON Schema that constrains the answer. */
export type RecordedNamingRequest = AgentTextGenerationInput & {
  outputSchema: AgentJsonOutputSchema;
};

/**
 * The naming service of the host on a model whose JSON answer `answer` gives. The fake checks the
 * answer with the answer schema of the request, as each runtime adapter does, and records each
 * request. The deadline is short, so `Effect.never` times out fast.
 */
export const createModelNamingService = (
  answer: (request: RecordedNamingRequest) => Effect.Effect<JsonValue, HostError>,
) => {
  const requests: RecordedNamingRequest[] = [];
  const service = createNamingService({
    timeout: "50 millis",
    settingsConfig: { readGlobalConfig: () => Effect.succeed(createDefaultGlobalConfig()) },
    textGeneration: {
      generateJson: <Answer>({ answerSchema, ...input }: AgentJsonGenerationInput<Answer>) =>
        Effect.gen(function* () {
          const request = { ...input, outputSchema: agentJsonOutputSchema(answerSchema) };
          requests.push(request);
          const parsed = answerSchema.safeParse(yield* answer(request));
          if (parsed.success) return parsed.data;
          return yield* new HostOperationError({
            operation: "test.generateJson",
            message: agentJsonAnswerMismatch("The test model", parsed.error).message,
          });
        }),
    },
  });
  return { service, requests };
};

export const createNamingTestDependencies = (
  overrides: Partial<WorkspaceSessionNamingDependencies> = {},
): WorkspaceSessionNamingDependencies => ({
  service: disabledNamingService,
  settings: { getRepoConfig: unexpectedEffectCall("workspace settings", "getRepoConfig") },
  ...overrides,
});
