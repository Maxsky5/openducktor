import {
  formatRuntimeDescriptorSchemaIssue,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  runtimeDescriptorSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { z } from "zod";
import {
  errorMessage,
  HostOperationError,
  type HostOperationErrorAggregate,
} from "../../effect/host-errors";

export type RuntimeDefinitionsService = {
  /** Static descriptors with the host safety gate applied. */
  listRuntimeDefinitions(): RuntimeDescriptor[];
  /**
   * Descriptors for the client. Runtime-conditional capabilities, such as the Claude
   * interrupted-turn resume path, resolve against the current environment before the
   * frontend can offer an action the adapter would reject.
   */
  listEffectiveRuntimeDefinitions(): Effect.Effect<
    RuntimeDescriptor[],
    HostOperationErrorAggregate
  >;
};

export type RuntimeDefinitionsServiceOptions = {
  /**
   * Safety gate for the Claude interrupted-turn resume path. When the gate is off, the
   * effective Claude descriptor reports no support and the adapter rejects the request.
   */
  claudeInterruptedTurnResumeEnabled?: boolean;
  /**
   * Reports whether the executable the Claude runtime will run owns the verified
   * interrupted-turn continuation contract. The probe fails closed.
   */
  resolveClaudeInterruptedTurnResumeSupport?: () => Effect.Effect<boolean>;
};

const describeRuntimeDescriptor = (descriptor: RuntimeDescriptor): string => {
  const parsedKind = z.string().min(1).safeParse(descriptor.kind);
  return parsedKind.success ? parsedKind.data : "unknown";
};

const withClaudeResumeCapability = (
  descriptor: RuntimeDescriptor,
  supported: boolean,
): RuntimeDescriptor => {
  if (descriptor.kind !== "claude" || supported) {
    return descriptor;
  }
  return {
    ...descriptor,
    capabilities: {
      ...descriptor.capabilities,
      sessionLifecycle: {
        ...descriptor.capabilities.sessionLifecycle,
        supportsInterruptedTurnResume: false,
      },
    },
  };
};

const parseRuntimeDescriptor = (descriptor: RuntimeDescriptor): RuntimeDescriptor => {
  const result = runtimeDescriptorSchema.safeParse(descriptor);
  if (result.success) {
    return result.data;
  }

  const errors = result.error.issues.map(formatRuntimeDescriptorSchemaIssue);
  throw new Error(
    `Runtime '${describeRuntimeDescriptor(descriptor)}' is incompatible with OpenDucktor: ${errors.join("; ")}`,
  );
};

const parseRuntimeDescriptors = (): RuntimeDescriptor[] =>
  Object.values(RUNTIME_DESCRIPTORS_BY_KIND).map(parseRuntimeDescriptor);

export const createRuntimeDefinitionsService = (
  options: RuntimeDefinitionsServiceOptions = {},
): RuntimeDefinitionsService => ({
  listRuntimeDefinitions() {
    const claudeSupported = options.claudeInterruptedTurnResumeEnabled !== false;
    return parseRuntimeDescriptors().map((descriptor) =>
      withClaudeResumeCapability(descriptor, claudeSupported),
    );
  },
  listEffectiveRuntimeDefinitions() {
    return Effect.gen(function* () {
      const claudeSupported =
        options.claudeInterruptedTurnResumeEnabled !== false &&
        (options.resolveClaudeInterruptedTurnResumeSupport === undefined
          ? true
          : yield* options.resolveClaudeInterruptedTurnResumeSupport());
      const descriptors = yield* Effect.try({
        try: parseRuntimeDescriptors,
        catch: (cause) =>
          new HostOperationError({
            operation: "runtimeDefinitions.list",
            message: errorMessage(cause),
            cause,
          }),
      });
      return descriptors.map((descriptor) =>
        withClaudeResumeCapability(descriptor, claudeSupported),
      );
    });
  },
});
