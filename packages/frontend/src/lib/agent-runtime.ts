import {
  type AgentRuntimes,
  type AgentSessionStartMode,
  formatRuntimeDescriptorSchemaIssue,
  getMissingRequiredRuntimeSupportedScopes,
  mandatoryRuntimeCapabilityKeys,
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
import { SESSION_LAUNCH_ACTIONS, sessionLaunchActionIds } from "./session-launch-actions";

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

export const isRuntimeEnabled = (agentRuntimes: AgentRuntimes, runtimeKind: RuntimeKind): boolean =>
  agentRuntimes[runtimeKind]?.enabled === true;

export const filterEnabledRuntimeDefinitions = (
  runtimeDefinitions: RuntimeDescriptor[],
  agentRuntimes: AgentRuntimes,
): RuntimeDescriptor[] =>
  runtimeDefinitions.filter((definition) => isRuntimeEnabled(agentRuntimes, definition.kind));

export const getAvailableRuntimeDefinitions = ({
  runtimeDefinitions,
  agentRuntimes,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  agentRuntimes: AgentRuntimes;
}): RuntimeDescriptor[] => {
  return filterEnabledRuntimeDefinitions(runtimeDefinitions, agentRuntimes);
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
      requestedRuntimeKind?: RuntimeKind | null;
    };

export const resolveRuntimeKindSelectionState = ({
  runtimeDefinitions,
  requestedRuntimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  requestedRuntimeKind?: RuntimeKind | null;
}): RuntimeKindSelectionResolution => {
  if (runtimeDefinitions.length === 0) {
    return {
      status: "no-definitions",
      runtimeKind: null,
      ...(requestedRuntimeKind === undefined ? {} : { requestedRuntimeKind }),
    };
  }

  if (!requestedRuntimeKind) {
    return { status: "missing-request", runtimeKind: null };
  }

  const matching = findRuntimeDefinition(runtimeDefinitions, requestedRuntimeKind);
  if (!matching) {
    return {
      status: "unknown-request",
      runtimeKind: null,
      requestedRuntimeKind,
    };
  }

  return {
    status: "resolved",
    runtimeKind: matching.kind,
    requestedRuntimeKind,
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

export const runtimeSupportsStartMode = (
  runtimeDescriptor: RuntimeDescriptor,
  startMode: AgentSessionStartMode,
): boolean => {
  return runtimeDescriptor.capabilities.sessionLifecycle.supportedStartModes.includes(startMode);
};

export const filterRuntimeDefinitionsForStartMode = (
  runtimeDefinitions: RuntimeDescriptor[],
  startMode: AgentSessionStartMode,
): RuntimeDescriptor[] => {
  return runtimeDefinitions.filter((definition) => runtimeSupportsStartMode(definition, startMode));
};

export const getAvailableRuntimeDefinitionsForStartMode = ({
  runtimeDefinitions,
  agentRuntimes,
  startMode,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  agentRuntimes: AgentRuntimes;
  startMode: AgentSessionStartMode;
}): RuntimeDescriptor[] => {
  return filterRuntimeDefinitionsForStartMode(
    getAvailableRuntimeDefinitions({ runtimeDefinitions, agentRuntimes }),
    startMode,
  );
};

export const runtimeSupportsCapability = (
  runtimeDescriptor: RuntimeDescriptor,
  capability: RuntimeCapabilityKey,
): boolean => {
  switch (capability) {
    case "workflow.supportsOdtWorkflowTools":
      return runtimeDescriptor.capabilities.workflow.supportsOdtWorkflowTools;
    case "workflow.supportedScopes":
      return (
        getMissingRequiredRuntimeSupportedScopes(
          runtimeDescriptor.capabilities.workflow.supportedScopes,
        ).length === 0
      );
    case "approvals.readOnlyAutoRejectSafe":
      return runtimeDescriptor.capabilities.approvals.readOnlyAutoRejectSafe;
    case "sessionLifecycle.supportedStartModes":
      return runtimeDescriptor.capabilities.sessionLifecycle.supportedStartModes.includes("fresh");
    case "sessionLifecycle.supportsSessionFork":
      return runtimeDescriptor.capabilities.sessionLifecycle.supportsSessionFork;
    case "sessionLifecycle.supportsQueuedUserMessages":
      return runtimeDescriptor.capabilities.sessionLifecycle.supportsQueuedUserMessages;
    case "history.fidelity":
      return runtimeDescriptor.capabilities.history.fidelity !== "none";
    case "history.replay":
      return runtimeDescriptor.capabilities.history.replay !== "none";
    case "approvals.supportedRequestTypes":
      return runtimeDescriptor.capabilities.approvals.supportedRequestTypes.length > 0;
    case "approvals.supportedReplyOutcomes":
      return runtimeDescriptor.capabilities.approvals.supportedReplyOutcomes.length > 0;
    case "structuredInput.supportsQuestions":
      return runtimeDescriptor.capabilities.structuredInput.supportsQuestions;
    case "promptInput.supportedParts":
      return runtimeDescriptor.capabilities.promptInput.supportedParts.includes("text");
    case "promptInput.supportsAttachments":
      return runtimeDescriptor.capabilities.promptInput.supportsAttachments;
    case "promptInput.supportsSlashCommands":
      return runtimeDescriptor.capabilities.promptInput.supportsSlashCommands;
    case "promptInput.supportsFileSearch":
      return runtimeDescriptor.capabilities.promptInput.supportsFileSearch;
    case "promptInput.supportsSkillReferences":
      return runtimeDescriptor.capabilities.promptInput.supportsSkillReferences;
    case "promptInput.supportsSubagentReferences":
      return runtimeDescriptor.capabilities.promptInput.supportsSubagentReferences;
    case "optionalSurfaces.supportsProfiles":
      return runtimeDescriptor.capabilities.optionalSurfaces.supportsProfiles;
    case "optionalSurfaces.supportsVariants":
      return runtimeDescriptor.capabilities.optionalSurfaces.supportsVariants;
    case "optionalSurfaces.supportsTodos":
      return runtimeDescriptor.capabilities.optionalSurfaces.supportsTodos;
    case "optionalSurfaces.supportsDiff":
      return runtimeDescriptor.capabilities.optionalSurfaces.supportsDiff;
    case "optionalSurfaces.supportsFileStatus":
      return runtimeDescriptor.capabilities.optionalSurfaces.supportsFileStatus;
    case "optionalSurfaces.supportsMcpStatus":
      return runtimeDescriptor.capabilities.optionalSurfaces.supportsMcpStatus;
    case "optionalSurfaces.supportsSubagents":
      return runtimeDescriptor.capabilities.optionalSurfaces.supportsSubagents;
    case "optionalSurfaces.supportedSubagentExecutionModes":
      return (
        runtimeDescriptor.capabilities.optionalSurfaces.supportedSubagentExecutionModes.length > 0
      );
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

  if (!runtimeDescriptor.capabilities.approvals.readOnlyAutoRejectSafe) {
    errors.push("[workflow] read-only roles must auto-reject mutating approval requests");
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

  const launchErrors = getRuntimeDescriptorLaunchConfigErrors(runtimeDescriptor);
  errors.push(...launchErrors);

  return errors;
};

const launchStartModeRequirements = sessionLaunchActionIds.map((id) => SESSION_LAUNCH_ACTIONS[id]);

const formatStartModes = (startModes: readonly AgentSessionStartMode[]): string => {
  return startModes.length > 0 ? startModes.join(", ") : "none";
};

const runtimeSupportsAnyLaunchStartMode = (
  runtimeDescriptor: RuntimeDescriptor,
  allowedStartModes: readonly AgentSessionStartMode[],
): boolean => {
  return allowedStartModes.some((startMode) =>
    runtimeSupportsStartMode(runtimeDescriptor, startMode),
  );
};

export const getRuntimeDescriptorLaunchConfigErrors = (
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  return launchStartModeRequirements.flatMap((launch) => {
    if (!runtimeSupportsRole(runtimeDescriptor, launch.role)) {
      return [];
    }
    if (runtimeSupportsAnyLaunchStartMode(runtimeDescriptor, launch.allowedStartModes)) {
      return [];
    }

    const supportedStartModes = runtimeDescriptor.capabilities.sessionLifecycle.supportedStartModes;
    return [
      `[launch_scoped] launch ${launch.id} has no supported start mode (allowed: ${formatStartModes(launch.allowedStartModes)}; runtime supports: ${formatStartModes(supportedStartModes)})`,
    ];
  });
};

export const validateRuntimeDefinitionForOpenDucktor = (
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  const descriptorParseResult = runtimeDescriptorSchema.safeParse(runtimeDescriptor);
  if (!descriptorParseResult.success) {
    // Intentionally stop after schema validation: capability policy checks assume a parsed
    // descriptor shape and can mask the root structural error on stale/malformed payloads.
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
