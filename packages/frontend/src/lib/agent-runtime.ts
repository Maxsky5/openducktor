import {
  getMissingRequiredRuntimeSupportedScopes,
  mandatoryRuntimeCapabilityKeys,
  type RuntimeCapabilityKey,
  type RuntimeDescriptor,
  type RuntimeKind,
  runtimeRequiredScopesByRole,
} from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { createElement } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import type { ComboboxOption } from "@/components/ui/combobox";

export const DEFAULT_RUNTIME_KIND = "opencode" as const satisfies RuntimeKind;

const agentRoles = Object.keys(runtimeRequiredScopesByRole) as AgentRole[];

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

export type RuntimeKindSelectionResolution =
  | {
      status: "resolved";
      runtimeKind: RuntimeKind;
      requestedRuntimeKind: RuntimeKind;
    }
  | {
      status: "missing-request";
      runtimeKind: null;
    }
  | {
      status: "unknown-request";
      runtimeKind: null;
      requestedRuntimeKind: RuntimeKind;
    }
  | {
      status: "no-definitions";
      runtimeKind: null;
      requestedRuntimeKind: RuntimeKind | null;
    };

const normalizeRequestedRuntimeKind = (
  runtimeKind: RuntimeKind | null | undefined,
): RuntimeKind | null => {
  const trimmed = runtimeKind?.trim();
  return trimmed ? trimmed : null;
};

export const resolveRuntimeKindSelectionState = ({
  runtimeDefinitions,
  requestedRuntimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  requestedRuntimeKind?: RuntimeKind | null;
}): RuntimeKindSelectionResolution => {
  const normalizedRequestedRuntimeKind = normalizeRequestedRuntimeKind(requestedRuntimeKind);
  if (runtimeDefinitions.length === 0) {
    return {
      status: "no-definitions",
      runtimeKind: null,
      requestedRuntimeKind: normalizedRequestedRuntimeKind,
    };
  }

  if (!normalizedRequestedRuntimeKind) {
    return { status: "missing-request", runtimeKind: null };
  }

  const matching = findRuntimeDefinition(runtimeDefinitions, normalizedRequestedRuntimeKind);
  if (!matching) {
    return {
      status: "unknown-request",
      runtimeKind: null,
      requestedRuntimeKind: normalizedRequestedRuntimeKind,
    };
  }

  return {
    status: "resolved",
    runtimeKind: matching.kind,
    requestedRuntimeKind: normalizedRequestedRuntimeKind,
  };
};

export const resolveRuntimeKindSelection = (
  input: Parameters<typeof resolveRuntimeKindSelectionState>[0],
): RuntimeKind | null => {
  return resolveRuntimeKindSelectionState(input).runtimeKind;
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

const supportedScopesSatisfyRole = (
  supportedScopes: readonly string[],
  role: AgentRole,
): boolean => {
  return runtimeRequiredScopesByRole[role].every((scope) => supportedScopes.includes(scope));
};

const roleScopeRequirementsDescription = (): string => {
  return agentRoles
    .map((role) => `${role} requires ${runtimeRequiredScopesByRole[role].join(", ")}`)
    .join("; ");
};

export const getRuntimeDescriptorCapabilityConfigErrors = (
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  const supportsAtLeastOneRole = agentRoles.some((role) =>
    supportedScopesSatisfyRole(runtimeDescriptor.capabilities.supportedScopes, role),
  );
  if (supportsAtLeastOneRole) {
    return [];
  }

  return [`missing workflow scopes for every agent role: ${roleScopeRequirementsDescription()}`];
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
  role: AgentRole,
): boolean => {
  return supportedScopesSatisfyRole(runtimeDescriptor.capabilities.supportedScopes, role);
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
