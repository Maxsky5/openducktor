import {
  formatRuntimeDescriptorSchemaIssue,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  runtimeDescriptorSchema,
} from "@openducktor/contracts";
import { z } from "zod";

export type RuntimeDefinitionsService = {
  listRuntimeDefinitions(): RuntimeDescriptor[];
};

export type RuntimeDefinitionsServiceOptions = {
  /**
   * Safety gate for the Claude interrupted-turn resume path. When the gate is off, the
   * effective Claude descriptor reports no support and the adapter rejects the request.
   */
  claudeInterruptedTurnResumeEnabled?: boolean;
};

const describeRuntimeDescriptor = (descriptor: RuntimeDescriptor): string => {
  const parsedKind = z.string().min(1).safeParse(descriptor.kind);
  return parsedKind.success ? parsedKind.data : "unknown";
};

const withEffectiveCapabilities = (
  descriptor: RuntimeDescriptor,
  { claudeInterruptedTurnResumeEnabled }: RuntimeDefinitionsServiceOptions,
): RuntimeDescriptor => {
  if (descriptor.kind !== "claude" || claudeInterruptedTurnResumeEnabled !== false) {
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

export const createRuntimeDefinitionsService = (
  options: RuntimeDefinitionsServiceOptions = {},
): RuntimeDefinitionsService => ({
  listRuntimeDefinitions() {
    return Object.values(RUNTIME_DESCRIPTORS_BY_KIND)
      .map((descriptor) => withEffectiveCapabilities(descriptor, options))
      .map(parseRuntimeDescriptor);
  },
});
