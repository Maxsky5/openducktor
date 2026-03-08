import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { ComboboxOption } from "@/components/ui/combobox";

export const DEFAULT_RUNTIME_KIND = "opencode" as const satisfies RuntimeKind;

export const toAgentRuntimeOptions = (
  runtimeDefinitions: RuntimeDescriptor[],
): ComboboxOption[] => {
  return runtimeDefinitions.map((definition) => ({
    value: definition.kind,
    label: definition.label,
    description: definition.description,
  }));
};

export const findRuntimeDefinition = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind,
): RuntimeDescriptor | null => {
  return runtimeDefinitions.find((definition) => definition.kind === runtimeKind) ?? null;
};

export const resolveRuntimeKindSelection = ({
  runtimeDefinitions,
  requestedRuntimeKind,
  fallbackRuntimeKind = DEFAULT_RUNTIME_KIND,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  requestedRuntimeKind?: RuntimeKind | null;
  fallbackRuntimeKind?: RuntimeKind;
}): RuntimeKind => {
  if (requestedRuntimeKind) {
    const matching = findRuntimeDefinition(runtimeDefinitions, requestedRuntimeKind);
    if (matching) {
      return matching.kind;
    }
  }

  return runtimeDefinitions[0]?.kind ?? requestedRuntimeKind ?? fallbackRuntimeKind;
};

export const requireRuntimeDefinition = ({
  runtimeDefinitions,
  runtimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeKind: RuntimeKind;
}): RuntimeDescriptor => {
  const definition = findRuntimeDefinition(runtimeDefinitions, runtimeKind);
  if (!definition) {
    throw new Error(`Unsupported agent runtime '${runtimeKind}'.`);
  }
  return definition;
};

export const runtimeLabelFor = ({
  runtimeDefinitions,
  runtimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeKind: RuntimeKind;
}): string => {
  return findRuntimeDefinition(runtimeDefinitions, runtimeKind)?.label ?? runtimeKind;
};
