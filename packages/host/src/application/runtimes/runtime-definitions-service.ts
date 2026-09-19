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

const describeRuntimeDescriptor = (descriptor: RuntimeDescriptor): string => {
  const parsedKind = z.string().min(1).safeParse(descriptor.kind);
  return parsedKind.success ? parsedKind.data : "unknown";
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

export const createRuntimeDefinitionsService = (): RuntimeDefinitionsService => ({
  listRuntimeDefinitions() {
    return parseRuntimeDescriptors();
  },
});
