import {
  mandatoryRuntimeCapabilityKeys,
  type RuntimeCapabilityKey,
  type RuntimeDescriptor,
  type RuntimeKind,
  runtimeRequiredScopesByRole,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { createElement } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents";
import type { ComboboxOption } from "@/components/ui/combobox";

export const DEFAULT_RUNTIME_KIND = "opencode" as const satisfies RuntimeKind;

export const toAgentRuntimeOptions = (
  runtimeDefinitions: RuntimeDescriptor[],
): ComboboxOption[] => {
  return runtimeDefinitions.map((definition) => ({
    value: definition.kind,
    label: definition.label,
    icon: createElement(AgentRuntimeIcon, { runtimeKind: definition.kind }),
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

export const runtimeSupportsCapability = (
  runtimeDescriptor: RuntimeDescriptor,
  capability: RuntimeCapabilityKey,
): boolean => {
  return runtimeDescriptor.capabilities[capability];
};

export const getMissingMandatoryRuntimeCapabilities = (
  runtimeDescriptor: RuntimeDescriptor,
): RuntimeCapabilityKey[] => {
  return mandatoryRuntimeCapabilityKeys.filter(
    (capability) => !runtimeSupportsCapability(runtimeDescriptor, capability),
  );
};

export const getRuntimeDescriptorCapabilityConfigErrors = (
  _runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  return [];
};

export const validateRuntimeDefinitionForOpenDucktor = (
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  const missingMandatory = getMissingMandatoryRuntimeCapabilities(runtimeDescriptor);
  const errors = [...getRuntimeDescriptorCapabilityConfigErrors(runtimeDescriptor)];
  if (missingMandatory.length > 0) {
    errors.unshift(`missing mandatory capabilities: ${missingMandatory.join(", ")}`);
  }
  return errors;
};

export const runtimeSupportsRole = (
  runtimeDescriptor: RuntimeDescriptor,
  role: AgentRole,
): boolean => {
  return runtimeRequiredScopesByRole[role].every((scope) =>
    runtimeDescriptor.capabilities.supportedScopes.includes(scope),
  );
};

export const filterRuntimeDefinitionsForRole = (
  runtimeDefinitions: RuntimeDescriptor[],
  role: AgentRole,
): RuntimeDescriptor[] => {
  return runtimeDefinitions.filter((definition) => runtimeSupportsRole(definition, role));
};

export const runtimeSupportsAllRoles = (runtimeDescriptor: RuntimeDescriptor): boolean => {
  return Object.values(runtimeRequiredScopesByRole).every((scopes) =>
    scopes.every((scope) => runtimeDescriptor.capabilities.supportedScopes.includes(scope)),
  );
};

export const filterRuntimeDefinitionsForDefaultSelection = (
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeDescriptor[] => {
  return runtimeDefinitions.filter(runtimeSupportsAllRoles);
};
