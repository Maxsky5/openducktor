import {
  type AgentRuntimes,
  type AgentSessionStartMode,
  formatRuntimeDescriptorSchemaIssue,
  mandatoryRuntimeCapabilityKeys,
  type RuntimeCapabilityKey,
  type RuntimeDescriptor,
  type RuntimeKind,
  runtimeDescriptorSchema,
} from "@openducktor/contracts";
import type { TaskWorkflowRole } from "@openducktor/workflows";

export const DEFAULT_RUNTIME_KIND = "opencode" as const satisfies RuntimeKind;

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
    const resolution: Extract<RuntimeKindSelectionResolution, { status: "no-definitions" }> = {
      status: "no-definitions",
      runtimeKind: null,
    };
    if (requestedRuntimeKind !== undefined) {
      resolution.requestedRuntimeKind = requestedRuntimeKind;
    }
    return resolution;
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
    case "speed.support":
      return runtimeDescriptor.capabilities.speed.support !== "none";
    case "workflow.supportsOdtWorkflowTools":
      return runtimeDescriptor.capabilities.workflow.supportsOdtWorkflowTools;
    case "workflow.supportedScopes":
      return runtimeDescriptor.capabilities.workflow.supportedScopes.length > 0;
    case "approvals.readOnlyAutoRejectSafe":
      return runtimeDescriptor.capabilities.approvals.readOnlyAutoRejectSafe;
    case "sessionLifecycle.supportedStartModes":
      return runtimeDescriptor.capabilities.sessionLifecycle.supportedStartModes.includes("fresh");
    case "sessionLifecycle.supportsSessionFork":
      return runtimeDescriptor.capabilities.sessionLifecycle.supportsSessionFork;
    case "sessionLifecycle.supportsInterruptedTurnResume":
      return runtimeDescriptor.capabilities.sessionLifecycle.supportsInterruptedTurnResume;
    case "messageDelivery.minimumSteeringRuntimeVersion":
      return runtimeDescriptor.capabilities.messageDelivery.minimumSteeringRuntimeVersion !== null;
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
    case "optionalSurfaces.supportsImageGeneration":
      return runtimeDescriptor.capabilities.optionalSurfaces.supportsImageGeneration;
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
  role: TaskWorkflowRole,
): boolean => {
  const scopes = new Set(supportedScopes);
  return role.runtimeScopes.every((scope) => scopes.has(scope));
};

/**
 * The workflow compatibility of a runtime. Role scopes and launch start modes are checked when a
 * session starts, against the workflow of its task.
 */
export const getRuntimeDescriptorCapabilityConfigErrors = (
  runtimeDescriptor: RuntimeDescriptor,
): string[] => {
  const errors: string[] = [];
  if (!runtimeDescriptor.capabilities.workflow.supportsOdtWorkflowTools)
    errors.push("[workflow] missing OpenDucktor workflow tool support");
  if (!runtimeDescriptor.capabilities.approvals.readOnlyAutoRejectSafe)
    errors.push("[workflow] read-only roles must auto-reject mutating approval requests");
  return errors;
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
  role: TaskWorkflowRole,
): boolean => {
  return supportedScopesSatisfyRole(runtimeDescriptor.capabilities.workflow.supportedScopes, role);
};

export const filterRuntimeDefinitionsForRole = (
  runtimeDefinitions: RuntimeDescriptor[],
  role: TaskWorkflowRole,
): RuntimeDescriptor[] => {
  return runtimeDefinitions.filter((definition) => runtimeSupportsRole(definition, role));
};

export const filterRuntimeDefinitionsForDefaultSelection = (
  runtimeDefinitions: RuntimeDescriptor[],
  roles: readonly TaskWorkflowRole[] = [],
): RuntimeDescriptor[] =>
  runtimeDefinitions.filter((runtime) => roles.every((role) => runtimeSupportsRole(runtime, role)));
