import {
  getMissingRequiredRuntimeSupportedScopes,
  mandatoryRuntimeCapabilityKeys,
  type RuntimeCapabilityKey,
  type RuntimeDescriptor,
  type RuntimeKind,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { createElement } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
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

export const runtimeLabelFor = ({
  runtimeDefinitions,
  runtimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  runtimeKind: RuntimeKind;
}): string => {
  return findRuntimeDefinition(runtimeDefinitions, runtimeKind)?.label ?? runtimeKind;
};

const runtimeSupportsCapability = (
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
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  const missingSupportedScopes = getMissingRequiredRuntimeSupportedScopes(
    runtimeDescriptor.capabilities.supportedScopes,
  );
  if (missingSupportedScopes.length === 0) {
    return [];
  }

  return [`missing required workflow scopes: ${missingSupportedScopes.join(", ")}`];
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

export const validateRuntimeDefinitionsForOpenDucktor = (
  runtimeDefinitions: RuntimeDescriptor[],
): string[] => {
  return runtimeDefinitions.flatMap((runtimeDescriptor) => {
    const errors = validateRuntimeDefinitionForOpenDucktor(runtimeDescriptor);
    if (errors.length === 0) {
      return [];
    }

    return [
      `Runtime '${runtimeDescriptor.kind}' is incompatible with OpenDucktor: ${errors.join("; ")}`,
    ];
  });
};

export const runtimeSupportsRole = (
  runtimeDescriptor: RuntimeDescriptor,
  _role: AgentRole,
): boolean => {
  return runtimeSupportsAllRoles(runtimeDescriptor);
};

export const filterRuntimeDefinitionsForRole = (
  runtimeDefinitions: RuntimeDescriptor[],
  role: AgentRole,
): RuntimeDescriptor[] => {
  return runtimeDefinitions.filter((definition) => runtimeSupportsRole(definition, role));
};

const runtimeSupportsAllRoles = (runtimeDescriptor: RuntimeDescriptor): boolean => {
  return (
    getMissingRequiredRuntimeSupportedScopes(runtimeDescriptor.capabilities.supportedScopes)
      .length === 0
  );
};

export const filterRuntimeDefinitionsForDefaultSelection = (
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeDescriptor[] => {
  return runtimeDefinitions.filter(runtimeSupportsAllRoles);
};
