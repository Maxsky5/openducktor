import {
  formatRuntimeDescriptorSchemaIssue,
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  runtimeDescriptorSchema,
} from "@openducktor/contracts";

export type RuntimeDefinitionsService = {
  listRuntimeDefinitions(): RuntimeDescriptor[];
};

const describeRuntimeDescriptor = (descriptor: RuntimeDescriptor): string => {
  return typeof descriptor.kind === "string" && descriptor.kind.length > 0
    ? descriptor.kind
    : "unknown";
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

export const createRuntimeDefinitionsService = (): RuntimeDefinitionsService => ({
  listRuntimeDefinitions() {
    return Object.values(RUNTIME_DESCRIPTORS_BY_KIND).map(parseRuntimeDescriptor);
  },
});
