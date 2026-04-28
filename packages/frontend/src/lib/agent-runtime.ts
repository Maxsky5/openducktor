import {
  type AgentScenario,
  type AgentSessionStartMode,
  agentScenarioDefinitionByScenario,
  agentScenarioValues,
  getMissingRequiredRuntimeSupportedScopes,
  mandatoryRuntimeCapabilityKeys,
  type RuntimeCapabilityClass,
  type RuntimeCapabilityKey,
  type RuntimeDescriptor,
  type RuntimeKind,
  runtimeDescriptorSchema,
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
  switch (capability) {
    case "workflow.supportsOdtWorkflowTools":
      return runtimeDescriptor.capabilities.workflow.supportsOdtWorkflowTools;
    case "sessionLifecycle.supportedStartModes":
      return runtimeDescriptor.capabilities.sessionLifecycle.supportedStartModes.includes("fresh");
    case "promptInput.supportedParts":
      return runtimeDescriptor.capabilities.promptInput.supportedParts.includes("text");
    default:
      return true;
  }
};

export const getMissingMandatoryRuntimeCapabilities = (
  runtimeDescriptor: RuntimeDescriptor,
): RuntimeCapabilityKey[] => {
  return mandatoryRuntimeCapabilityKeys.filter(
    (capability) => !runtimeSupportsCapability(runtimeDescriptor, capability),
  );
};

const supportedScopesSatisfyRole = (
  supportedScopes: RuntimeDescriptor["capabilities"]["workflow"]["supportedScopes"],
  role: AgentRole,
): boolean => {
  return runtimeRequiredScopesByRole[role].every((scope) => supportedScopes.includes(scope));
};

const roleScopeRequirementsDescription = (): string => {
  return agentRoles
    .map((role) => `${role} requires ${runtimeRequiredScopesByRole[role].join(", ")}`)
    .join("; ");
};

const classifyRuntimeDescriptorSchemaIssue = ({
  path,
  message,
}: {
  path: PropertyKey[];
  message: string;
}): RuntimeCapabilityClass => {
  const descriptorPath = path.map(String).join(".");
  const capabilityPath = path.slice(1).map(String).join(".");
  if (
    descriptorPath.startsWith("workflowToolAliasesByCanonical") ||
    descriptorPath.startsWith("readOnlyRoleBlockedTools")
  ) {
    return "workflow";
  }
  if (capabilityPath.startsWith("workflow.supportsOdtWorkflowTools")) {
    return "workflow";
  }
  if (capabilityPath.startsWith("workflow.supportedScopes")) {
    return "role_scoped";
  }
  if (capabilityPath.startsWith("sessionLifecycle.supportsSessionFork")) {
    return "scenario_scoped";
  }
  if (capabilityPath.startsWith("sessionLifecycle.forkTargets")) {
    return "scenario_scoped";
  }
  if (
    capabilityPath.startsWith("sessionLifecycle.supportedStartModes") &&
    message.toLowerCase().includes("fork")
  ) {
    return "scenario_scoped";
  }
  if (capabilityPath.startsWith("approvals.")) {
    return "workflow";
  }
  if (capabilityPath.startsWith("structuredInput.")) {
    return "workflow";
  }
  if (capabilityPath.startsWith("promptInput.supportedParts")) {
    if (message.includes("slash commands") || message.includes("file search")) {
      return "optional_enhancement";
    }
    return "baseline";
  }
  if (capabilityPath.startsWith("promptInput.supports")) {
    return "optional_enhancement";
  }
  if (capabilityPath.startsWith("optionalSurfaces.")) {
    return "optional_enhancement";
  }
  if (capabilityPath.startsWith("history.")) {
    return "baseline";
  }
  return "baseline";
};

const formatRuntimeDescriptorSchemaIssue = (issue: {
  path: PropertyKey[];
  message: string;
}): string => {
  const issueClass = classifyRuntimeDescriptorSchemaIssue(issue);
  const issuePath = issue.path.map(String).join(".") || "descriptor";
  return `[${issueClass}] runtime descriptor schema violation at ${issuePath}: ${issue.message}`;
};

export const getRuntimeDescriptorCapabilityConfigErrors = (
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  const errors: string[] = [];
  const missingWorkflowScopes = getMissingRequiredRuntimeSupportedScopes(
    runtimeDescriptor.capabilities.workflow.supportedScopes,
  );

  if (!runtimeDescriptor.capabilities.workflow.supportsOdtWorkflowTools) {
    errors.push("[workflow] missing OpenDucktor workflow tool support");
  }

  if (missingWorkflowScopes.length > 0) {
    errors.push(
      `[role_scoped] missing required workflow scopes: ${missingWorkflowScopes.join(", ")}`,
    );
  }

  const unsupportedRoles = agentRoles.filter(
    (role) =>
      !supportedScopesSatisfyRole(runtimeDescriptor.capabilities.workflow.supportedScopes, role),
  );
  if (unsupportedRoles.length > 0) {
    errors.push(
      `[role_scoped] unsupported agent roles: ${unsupportedRoles.join(", ")} (${roleScopeRequirementsDescription()})`,
    );
  }

  const scenarioErrors = getRuntimeDescriptorScenarioConfigErrors(runtimeDescriptor);
  errors.push(...scenarioErrors);

  return errors;
};

const getUnsupportedScenarioStartModes = (
  runtimeDescriptor: RuntimeDescriptor,
  scenario: AgentScenario,
): AgentSessionStartMode[] => {
  const supportedStartModes = runtimeDescriptor.capabilities.sessionLifecycle.supportedStartModes;
  return agentScenarioDefinitionByScenario[scenario].allowedStartModes.filter(
    (startMode) => !supportedStartModes.includes(startMode),
  );
};

export const runtimeSupportsScenario = (
  runtimeDescriptor: RuntimeDescriptor,
  scenario: AgentScenario,
): boolean => {
  const scenarioDefinition = agentScenarioDefinitionByScenario[scenario];
  return (
    runtimeSupportsRole(runtimeDescriptor, scenarioDefinition.role) &&
    getUnsupportedScenarioStartModes(runtimeDescriptor, scenario).length === 0
  );
};

export const getRuntimeDescriptorScenarioConfigErrors = (
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  return agentScenarioValues.flatMap((scenario) => {
    const missingStartModes = getUnsupportedScenarioStartModes(runtimeDescriptor, scenario);
    if (missingStartModes.length === 0) {
      return [];
    }

    return [
      `[scenario_scoped] scenario ${scenario} requires start modes: ${missingStartModes.join(", ")}`,
    ];
  });
};

export const validateRuntimeDefinitionForOpenDucktor = (
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  const descriptorParseResult = runtimeDescriptorSchema.safeParse(runtimeDescriptor);
  if (!descriptorParseResult.success) {
    return descriptorParseResult.error.issues.map(formatRuntimeDescriptorSchemaIssue);
  }

  return getRuntimeDescriptorCapabilityConfigErrors(descriptorParseResult.data);
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
  return supportedScopesSatisfyRole(runtimeDescriptor.capabilities.workflow.supportedScopes, role);
};

export const filterRuntimeDefinitionsForRole = (
  runtimeDefinitions: RuntimeDescriptor[],
  role: AgentRole,
): RuntimeDescriptor[] => {
  return runtimeDefinitions.filter((definition) => runtimeSupportsRole(definition, role));
};

const runtimeSupportsAllRoles = (runtimeDescriptor: RuntimeDescriptor): boolean => {
  return (
    getMissingRequiredRuntimeSupportedScopes(
      runtimeDescriptor.capabilities.workflow.supportedScopes,
    ).length === 0
  );
};

export const filterRuntimeDefinitionsForDefaultSelection = (
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeDescriptor[] => {
  return runtimeDefinitions.filter(runtimeSupportsAllRoles);
};
