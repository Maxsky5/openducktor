import {
  RUNTIME_DESCRIPTORS_BY_KIND,
  type RuntimeDescriptor,
  runtimeDescriptorSchema,
} from "@openducktor/contracts";

export type RuntimeDefinitionsService = {
  listRuntimeDefinitions(): RuntimeDescriptor[];
};

export const createRuntimeDefinitionsService = (): RuntimeDefinitionsService => ({
  listRuntimeDefinitions() {
    return Object.values(RUNTIME_DESCRIPTORS_BY_KIND).map((descriptor) =>
      runtimeDescriptorSchema.parse(descriptor),
    );
  },
});
