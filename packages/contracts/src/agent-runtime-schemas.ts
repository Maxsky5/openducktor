import { z } from "zod";
import {
  type AgentRole,
  type AgentToolName,
  agentSessionStartModeSchema,
} from "./agent-workflow-schemas";
import { ODT_WORKFLOW_AGENT_TOOL_NAMES } from "./odt-tool-names";

export const knownRuntimeKindValues = ["opencode"] as const;
export const knownRuntimeKindSchema = z.enum(knownRuntimeKindValues);
export type KnownRuntimeKind = z.infer<typeof knownRuntimeKindSchema>;

export const runtimeKindSchema = z.string().trim().min(1);
export type RuntimeKind = z.infer<typeof runtimeKindSchema>;

export const runtimeProvisioningModeSchema = z.enum(["host_managed", "external"]);
export type RuntimeProvisioningMode = z.infer<typeof runtimeProvisioningModeSchema>;

export const runtimeSupportedScopeValues = ["workspace", "task", "build"] as const;
export const runtimeSupportedScopeSchema = z.enum(runtimeSupportedScopeValues);
export type RuntimeSupportedScope = z.infer<typeof runtimeSupportedScopeSchema>;

export const runtimeSupportedScopesSchema = z
  .array(runtimeSupportedScopeSchema)
  .min(1)
  .refine((scopes) => new Set(scopes).size === scopes.length, {
    message: "Supported runtime scopes must be unique.",
  });

export const runtimeSubagentExecutionModeValues = ["foreground", "background"] as const;
export const runtimeSubagentExecutionModeSchema = z.enum(runtimeSubagentExecutionModeValues);
export type RuntimeSubagentExecutionMode = z.infer<typeof runtimeSubagentExecutionModeSchema>;

export const runtimeSupportedSubagentExecutionModesSchema = z
  .array(runtimeSubagentExecutionModeSchema)
  .refine((modes) => new Set(modes).size === modes.length, {
    message: "Supported subagent execution modes must be unique.",
  });

export const runtimeHistoryFidelityValues = ["none", "message", "item"] as const;
export const runtimeHistoryFidelitySchema = z.enum(runtimeHistoryFidelityValues);
export type RuntimeHistoryFidelity = z.infer<typeof runtimeHistoryFidelitySchema>;

export const runtimeHistoryReplayValues = [
  "none",
  "snapshot",
  "turn_items",
  "event_replay",
] as const;
export const runtimeHistoryReplaySchema = z.enum(runtimeHistoryReplayValues);
export type RuntimeHistoryReplay = z.infer<typeof runtimeHistoryReplaySchema>;

export const runtimeHydratedEventTypeValues = [
  "message",
  "tool_call",
  "tool_result",
  "approval_request",
  "question_request",
  "status_change",
] as const;
export const runtimeHydratedEventTypeSchema = z.enum(runtimeHydratedEventTypeValues);
export type RuntimeHydratedEventType = z.infer<typeof runtimeHydratedEventTypeSchema>;

export const runtimeApprovalRequestTypeValues = [
  "command_execution",
  "file_change",
  "permission_grant",
  "runtime_tool",
] as const;
export const runtimeApprovalRequestTypeSchema = z.enum(runtimeApprovalRequestTypeValues);
export type RuntimeApprovalRequestType = z.infer<typeof runtimeApprovalRequestTypeSchema>;

export const runtimeApprovalReplyOutcomeValues = [
  "approve_once",
  "approve_turn",
  "approve_session",
  "reject",
] as const;
export const runtimeApprovalReplyOutcomeSchema = z.enum(runtimeApprovalReplyOutcomeValues);
export type RuntimeApprovalReplyOutcome = z.infer<typeof runtimeApprovalReplyOutcomeSchema>;

export const runtimeOmittedPermissionBehaviorValues = [
  "deny",
  "requires_explicit_response",
] as const;
export const runtimeOmittedPermissionBehaviorSchema = z.enum(
  runtimeOmittedPermissionBehaviorValues,
);
export type RuntimeOmittedPermissionBehavior = z.infer<
  typeof runtimeOmittedPermissionBehaviorSchema
>;

export const runtimePendingInputVisibilityValues = ["live_snapshot", "history"] as const;
export const runtimePendingInputVisibilitySchema = z.enum(runtimePendingInputVisibilityValues);
export type RuntimePendingInputVisibility = z.infer<typeof runtimePendingInputVisibilitySchema>;

export const runtimeQuestionAnswerModeValues = [
  "free_text",
  "single_select",
  "multi_select",
] as const;
export const runtimeQuestionAnswerModeSchema = z.enum(runtimeQuestionAnswerModeValues);
export type RuntimeQuestionAnswerMode = z.infer<typeof runtimeQuestionAnswerModeSchema>;

export const runtimePromptInputPartTypeValues = [
  "text",
  "slash_command",
  "file_reference",
  "folder_reference",
  "skill_mention",
  "app_mention",
  "plugin_mention",
  "runtime_specific",
] as const;
export const runtimePromptInputPartTypeSchema = z.enum(runtimePromptInputPartTypeValues);
export type RuntimePromptInputPartType = z.infer<typeof runtimePromptInputPartTypeSchema>;

export const runtimeForkTargetValues = ["session", "message", "item"] as const;
export const runtimeForkTargetSchema = z.enum(runtimeForkTargetValues);
export type RuntimeForkTarget = z.infer<typeof runtimeForkTargetSchema>;

const createUniqueArraySchema = <T extends z.ZodTypeAny>(schema: T, message: string) =>
  z.array(schema).refine((items) => new Set(items).size === items.length, { message });

const runtimeSupportedStartModesSchema = createUniqueArraySchema(
  agentSessionStartModeSchema,
  "Supported session start modes must be unique.",
).min(1);

const runtimeForkTargetsSchema = createUniqueArraySchema(
  runtimeForkTargetSchema,
  "Runtime fork targets must be unique.",
);

const runtimeHydratedEventTypesSchema = createUniqueArraySchema(
  runtimeHydratedEventTypeSchema,
  "Runtime hydrated event types must be unique.",
);

const runtimeApprovalRequestTypesSchema = createUniqueArraySchema(
  runtimeApprovalRequestTypeSchema,
  "Runtime approval request types must be unique.",
);

const runtimeApprovalReplyOutcomesSchema = createUniqueArraySchema(
  runtimeApprovalReplyOutcomeSchema,
  "Runtime approval reply outcomes must be unique.",
);

const runtimePendingInputVisibilitySchemaList = createUniqueArraySchema(
  runtimePendingInputVisibilitySchema,
  "Runtime pending input visibility values must be unique.",
);

const runtimeQuestionAnswerModesSchema = createUniqueArraySchema(
  runtimeQuestionAnswerModeSchema,
  "Runtime question answer modes must be unique.",
);

const runtimePromptInputPartTypesSchema = createUniqueArraySchema(
  runtimePromptInputPartTypeSchema,
  "Runtime prompt input part types must be unique.",
).min(1);

const runtimeHistoryLimitationsSchema = createUniqueArraySchema(
  z.string().trim().min(1),
  "Runtime history limitations must be unique.",
);

export const runtimeWorkflowCapabilitiesSchema = z
  .object({
    supportsOdtWorkflowTools: z.boolean(),
    supportedScopes: runtimeSupportedScopesSchema,
  })
  .strict();
export type RuntimeWorkflowCapabilities = z.infer<typeof runtimeWorkflowCapabilitiesSchema>;

export const runtimeSessionLifecycleCapabilitiesSchema = z
  .object({
    supportedStartModes: runtimeSupportedStartModesSchema,
    supportsSessionFork: z.boolean(),
    forkTargets: runtimeForkTargetsSchema,
    supportsAttachLiveSessions: z.boolean(),
    supportsListLiveSessions: z.boolean(),
    supportsQueuedUserMessages: z.boolean(),
    supportsPendingInputSnapshots: z.boolean(),
  })
  .strict();
export type RuntimeSessionLifecycleCapabilities = z.infer<
  typeof runtimeSessionLifecycleCapabilitiesSchema
>;

export const runtimeHistoryCapabilitiesSchema = z
  .object({
    loadable: z.boolean(),
    fidelity: runtimeHistoryFidelitySchema,
    replay: runtimeHistoryReplaySchema,
    stableItemIds: z.boolean(),
    stableItemOrder: z.boolean(),
    exposesCompletionState: z.boolean(),
    hydratedEventTypes: runtimeHydratedEventTypesSchema,
    limitations: runtimeHistoryLimitationsSchema,
  })
  .strict();
export type RuntimeHistoryCapabilities = z.infer<typeof runtimeHistoryCapabilitiesSchema>;

export const runtimeApprovalCapabilitiesSchema = z
  .object({
    supportedRequestTypes: runtimeApprovalRequestTypesSchema,
    supportedReplyOutcomes: runtimeApprovalReplyOutcomesSchema,
    omittedPermissionBehavior: runtimeOmittedPermissionBehaviorSchema,
    pendingVisibility: runtimePendingInputVisibilitySchemaList,
    canClassifyMutatingRequests: z.boolean(),
    readOnlyAutoRejectSafe: z.boolean(),
  })
  .strict();
export type RuntimeApprovalCapabilities = z.infer<typeof runtimeApprovalCapabilitiesSchema>;

export const runtimeStructuredInputCapabilitiesSchema = z
  .object({
    supportsQuestions: z.boolean(),
    supportsMultipleQuestions: z.boolean(),
    supportedAnswerModes: runtimeQuestionAnswerModesSchema,
    supportsRequiredQuestions: z.boolean(),
    supportsDefaultValues: z.boolean(),
    supportsSecretInput: z.boolean(),
    supportsCustomAnswers: z.boolean(),
    supportsQuestionResolution: z.boolean(),
    pendingVisibility: runtimePendingInputVisibilitySchemaList,
  })
  .strict();
export type RuntimeStructuredInputCapabilities = z.infer<
  typeof runtimeStructuredInputCapabilitiesSchema
>;

export const runtimePromptInputCapabilitiesSchema = z
  .object({
    supportedParts: runtimePromptInputPartTypesSchema,
    supportsSlashCommands: z.boolean(),
    supportsFileSearch: z.boolean(),
  })
  .strict();
export type RuntimePromptInputCapabilities = z.infer<typeof runtimePromptInputCapabilitiesSchema>;

export const runtimeOptionalSurfaceCapabilitiesSchema = z
  .object({
    supportsProfiles: z.boolean(),
    supportsVariants: z.boolean(),
    supportsTodos: z.boolean(),
    supportsDiff: z.boolean(),
    supportsFileStatus: z.boolean(),
    supportsMcpStatus: z.boolean(),
    supportsSubagents: z.boolean(),
    supportedSubagentExecutionModes: runtimeSupportedSubagentExecutionModesSchema,
  })
  .strict();
export type RuntimeOptionalSurfaceCapabilities = z.infer<
  typeof runtimeOptionalSurfaceCapabilitiesSchema
>;

export const runtimeCapabilitiesSchema = z
  .object({
    provisioningMode: runtimeProvisioningModeSchema,
    workflow: runtimeWorkflowCapabilitiesSchema,
    sessionLifecycle: runtimeSessionLifecycleCapabilitiesSchema,
    history: runtimeHistoryCapabilitiesSchema,
    approvals: runtimeApprovalCapabilitiesSchema,
    structuredInput: runtimeStructuredInputCapabilitiesSchema,
    promptInput: runtimePromptInputCapabilitiesSchema,
    optionalSurfaces: runtimeOptionalSurfaceCapabilitiesSchema,
  })
  .strict()
  .superRefine((capabilities, context) => {
    const addIssue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: "custom", path, message });
    };

    if (!capabilities.sessionLifecycle.supportedStartModes.includes("fresh")) {
      addIssue(
        ["sessionLifecycle", "supportedStartModes"],
        'Runtime descriptors must support the "fresh" session start mode.',
      );
    }

    if (
      capabilities.sessionLifecycle.supportedStartModes.includes("fork") &&
      !capabilities.sessionLifecycle.supportsSessionFork
    ) {
      addIssue(
        ["sessionLifecycle", "supportsSessionFork"],
        'Runtime descriptors that allow "fork" start mode must support session forks.',
      );
    }

    if (
      capabilities.sessionLifecycle.supportsSessionFork &&
      !capabilities.sessionLifecycle.supportedStartModes.includes("fork")
    ) {
      addIssue(
        ["sessionLifecycle", "supportedStartModes"],
        'Runtime descriptors that support session forks must include the "fork" start mode.',
      );
    }

    if (
      capabilities.sessionLifecycle.supportsSessionFork &&
      capabilities.sessionLifecycle.forkTargets.length === 0
    ) {
      addIssue(
        ["sessionLifecycle", "forkTargets"],
        "Runtime descriptors that support session forks must declare at least one fork target.",
      );
    }

    if (
      !capabilities.sessionLifecycle.supportsSessionFork &&
      capabilities.sessionLifecycle.forkTargets.length > 0
    ) {
      addIssue(
        ["sessionLifecycle", "forkTargets"],
        "Runtime descriptors that do not support session forks must not declare fork targets.",
      );
    }

    if (capabilities.history.fidelity === "item") {
      if (!capabilities.history.loadable) {
        addIssue(
          ["history", "loadable"],
          "Runtime descriptors with item-level history fidelity must support history loading.",
        );
      }
      if (!capabilities.history.stableItemIds) {
        addIssue(
          ["history", "stableItemIds"],
          "Runtime descriptors with item-level history fidelity must expose stable item IDs.",
        );
      }
      if (!capabilities.history.stableItemOrder) {
        addIssue(
          ["history", "stableItemOrder"],
          "Runtime descriptors with item-level history fidelity must expose stable item ordering.",
        );
      }
      if (!capabilities.history.exposesCompletionState) {
        addIssue(
          ["history", "exposesCompletionState"],
          "Runtime descriptors with item-level history fidelity must expose item completion state.",
        );
      }
    }

    if (!capabilities.history.loadable) {
      if (capabilities.history.fidelity !== "none") {
        addIssue(
          ["history", "fidelity"],
          'Runtime descriptors without loadable history must use "none" history fidelity.',
        );
      }
      if (capabilities.history.replay !== "none") {
        addIssue(
          ["history", "replay"],
          'Runtime descriptors without loadable history must use "none" history replay.',
        );
      }
      if (capabilities.history.hydratedEventTypes.length > 0) {
        addIssue(
          ["history", "hydratedEventTypes"],
          "Runtime descriptors without loadable history must not declare hydrated event types.",
        );
      }
    }

    if (capabilities.approvals.supportedRequestTypes.length > 0) {
      const hasApproveOutcome = capabilities.approvals.supportedReplyOutcomes.some(
        (outcome) => outcome !== "reject",
      );
      if (!hasApproveOutcome) {
        addIssue(
          ["approvals", "supportedReplyOutcomes"],
          "Runtime descriptors with approval requests must support at least one approval reply outcome.",
        );
      }
      if (!capabilities.approvals.supportedReplyOutcomes.includes("reject")) {
        addIssue(
          ["approvals", "supportedReplyOutcomes"],
          'Runtime descriptors with approval requests must support the "reject" reply outcome.',
        );
      }
    }

    if (!capabilities.approvals.readOnlyAutoRejectSafe) {
      addIssue(
        ["approvals", "readOnlyAutoRejectSafe"],
        "Read-only roles must auto-reject mutating permission requests.",
      );
    } else {
      if (!capabilities.approvals.canClassifyMutatingRequests) {
        addIssue(
          ["approvals", "canClassifyMutatingRequests"],
          "Read-only auto-reject safety requires mutating request classification.",
        );
      }
      if (!capabilities.approvals.supportedReplyOutcomes.includes("reject")) {
        addIssue(
          ["approvals", "supportedReplyOutcomes"],
          'Read-only auto-reject safety requires the "reject" reply outcome.',
        );
      }
    }

    if (!capabilities.structuredInput.supportsQuestions) {
      const unsupportedQuestionDetails = [
        ["supportsMultipleQuestions", capabilities.structuredInput.supportsMultipleQuestions],
        ["supportsRequiredQuestions", capabilities.structuredInput.supportsRequiredQuestions],
        ["supportsDefaultValues", capabilities.structuredInput.supportsDefaultValues],
        ["supportsSecretInput", capabilities.structuredInput.supportsSecretInput],
        ["supportsCustomAnswers", capabilities.structuredInput.supportsCustomAnswers],
        ["supportsQuestionResolution", capabilities.structuredInput.supportsQuestionResolution],
      ] as const;

      for (const [field, value] of unsupportedQuestionDetails) {
        if (value) {
          addIssue(
            ["structuredInput", field],
            "Runtime descriptors that do not support structured questions must not declare question details.",
          );
        }
      }
      if (capabilities.structuredInput.supportedAnswerModes.length > 0) {
        addIssue(
          ["structuredInput", "supportedAnswerModes"],
          "Runtime descriptors that do not support structured questions must not declare answer modes.",
        );
      }
      if (capabilities.structuredInput.pendingVisibility.length > 0) {
        addIssue(
          ["structuredInput", "pendingVisibility"],
          "Runtime descriptors that do not support structured questions must not declare pending visibility.",
        );
      }
    } else {
      if (capabilities.structuredInput.supportedAnswerModes.length === 0) {
        addIssue(
          ["structuredInput", "supportedAnswerModes"],
          "Runtime descriptors that support structured questions must declare at least one answer mode.",
        );
      }
      if (!capabilities.structuredInput.supportsQuestionResolution) {
        addIssue(
          ["structuredInput", "supportsQuestionResolution"],
          "Runtime descriptors that support structured questions must support question resolution.",
        );
      }
    }

    if (!capabilities.sessionLifecycle.supportsPendingInputSnapshots) {
      if (capabilities.approvals.pendingVisibility.includes("live_snapshot")) {
        addIssue(
          ["approvals", "pendingVisibility"],
          "Approval live snapshot visibility requires pending input snapshot support.",
        );
      }
      if (capabilities.structuredInput.pendingVisibility.includes("live_snapshot")) {
        addIssue(
          ["structuredInput", "pendingVisibility"],
          "Structured input live snapshot visibility requires pending input snapshot support.",
        );
      }
    }

    if (!capabilities.promptInput.supportedParts.includes("text")) {
      addIssue(
        ["promptInput", "supportedParts"],
        'Runtime descriptors must support "text" prompt input.',
      );
    }

    if (
      capabilities.promptInput.supportsSlashCommands &&
      !capabilities.promptInput.supportedParts.includes("slash_command")
    ) {
      addIssue(
        ["promptInput", "supportedParts"],
        "Runtime descriptors that support slash commands must declare slash command prompt parts.",
      );
    }

    if (
      capabilities.promptInput.supportsFileSearch &&
      !capabilities.promptInput.supportedParts.some(
        (part) => part === "file_reference" || part === "folder_reference",
      )
    ) {
      addIssue(
        ["promptInput", "supportedParts"],
        "Runtime descriptors that support file search must declare file or folder prompt references.",
      );
    }

    if (
      capabilities.optionalSurfaces.supportsSubagents &&
      capabilities.optionalSurfaces.supportedSubagentExecutionModes.length === 0
    ) {
      addIssue(
        ["optionalSurfaces", "supportedSubagentExecutionModes"],
        "Runtime descriptors that support subagents must declare at least one supported subagent execution mode.",
      );
    }

    if (
      !capabilities.optionalSurfaces.supportsSubagents &&
      capabilities.optionalSurfaces.supportedSubagentExecutionModes.length > 0
    ) {
      addIssue(
        ["optionalSurfaces", "supportedSubagentExecutionModes"],
        "Runtime descriptors that do not support subagents must not declare subagent execution modes.",
      );
    }
  });
export type RuntimeCapabilities = z.infer<typeof runtimeCapabilitiesSchema>;

export const runtimeCapabilityKeyValues = [
  "workflow.supportsOdtWorkflowTools",
  "workflow.supportedScopes",
  "sessionLifecycle.supportedStartModes",
  "sessionLifecycle.supportsSessionFork",
  "sessionLifecycle.supportsQueuedUserMessages",
  "history.fidelity",
  "history.replay",
  "approvals.supportedRequestTypes",
  "approvals.supportedReplyOutcomes",
  "approvals.readOnlyAutoRejectSafe",
  "structuredInput.supportsQuestions",
  "promptInput.supportedParts",
  "promptInput.supportsSlashCommands",
  "promptInput.supportsFileSearch",
  "optionalSurfaces.supportsProfiles",
  "optionalSurfaces.supportsVariants",
  "optionalSurfaces.supportsTodos",
  "optionalSurfaces.supportsDiff",
  "optionalSurfaces.supportsFileStatus",
  "optionalSurfaces.supportsMcpStatus",
  "optionalSurfaces.supportsSubagents",
  "optionalSurfaces.supportedSubagentExecutionModes",
] as const;
export const runtimeCapabilityKeySchema = z.enum(runtimeCapabilityKeyValues);
export type RuntimeCapabilityKey = z.infer<typeof runtimeCapabilityKeySchema>;

export const mandatoryRuntimeCapabilityKeys = [
  "workflow.supportsOdtWorkflowTools",
  "approvals.readOnlyAutoRejectSafe",
  "sessionLifecycle.supportedStartModes",
  "promptInput.supportedParts",
] as const satisfies readonly RuntimeCapabilityKey[];

export const optionalRuntimeCapabilityKeys = [
  "sessionLifecycle.supportsQueuedUserMessages",
  "history.fidelity",
  "history.replay",
  "approvals.supportedRequestTypes",
  "approvals.supportedReplyOutcomes",
  "structuredInput.supportsQuestions",
  "promptInput.supportsSlashCommands",
  "promptInput.supportsFileSearch",
  "optionalSurfaces.supportsProfiles",
  "optionalSurfaces.supportsVariants",
  "optionalSurfaces.supportsTodos",
  "optionalSurfaces.supportsDiff",
  "optionalSurfaces.supportsFileStatus",
  "optionalSurfaces.supportsMcpStatus",
  "optionalSurfaces.supportsSubagents",
  "optionalSurfaces.supportedSubagentExecutionModes",
] as const satisfies readonly RuntimeCapabilityKey[];

export const runtimeRequiredScopesByRole = {
  spec: ["workspace"],
  planner: ["workspace"],
  qa: ["task"],
  build: ["build", "workspace"],
} as const satisfies Record<AgentRole, readonly RuntimeSupportedScope[]>;

const requiredRuntimeSupportedScopeSet = new Set<RuntimeSupportedScope>(
  Object.values(runtimeRequiredScopesByRole).flat(),
);

export const requiredRuntimeSupportedScopes = runtimeSupportedScopeValues.filter((scope) =>
  requiredRuntimeSupportedScopeSet.has(scope),
);

export const getMissingRequiredRuntimeSupportedScopes = (
  supportedScopes: readonly RuntimeSupportedScope[],
): RuntimeSupportedScope[] => {
  const supportedScopeSet = new Set<RuntimeSupportedScope>(supportedScopes);
  return requiredRuntimeSupportedScopes.filter((scope) => !supportedScopeSet.has(scope));
};

export type RuntimeCapabilityClass =
  | "baseline"
  | "workflow"
  | "role_scoped"
  | "scenario_scoped"
  | "optional_enhancement";

export const runtimeCapabilityClasses = {
  "workflow.supportsOdtWorkflowTools": "workflow",
  "workflow.supportedScopes": "role_scoped",
  "sessionLifecycle.supportedStartModes": "baseline",
  "sessionLifecycle.supportsSessionFork": "scenario_scoped",
  "sessionLifecycle.supportsQueuedUserMessages": "optional_enhancement",
  "history.fidelity": "scenario_scoped",
  "history.replay": "scenario_scoped",
  "approvals.supportedRequestTypes": "workflow",
  "approvals.supportedReplyOutcomes": "workflow",
  "approvals.readOnlyAutoRejectSafe": "workflow",
  "structuredInput.supportsQuestions": "workflow",
  "promptInput.supportedParts": "baseline",
  "promptInput.supportsSlashCommands": "optional_enhancement",
  "promptInput.supportsFileSearch": "optional_enhancement",
  "optionalSurfaces.supportsProfiles": "optional_enhancement",
  "optionalSurfaces.supportsVariants": "optional_enhancement",
  "optionalSurfaces.supportsTodos": "optional_enhancement",
  "optionalSurfaces.supportsDiff": "optional_enhancement",
  "optionalSurfaces.supportsFileStatus": "optional_enhancement",
  "optionalSurfaces.supportsMcpStatus": "optional_enhancement",
  "optionalSurfaces.supportsSubagents": "optional_enhancement",
  "optionalSurfaces.supportedSubagentExecutionModes": "optional_enhancement",
} as const satisfies Record<RuntimeCapabilityKey, RuntimeCapabilityClass>;

export const runtimeRefSchema = z.object({
  kind: runtimeKindSchema,
});
export type RuntimeRef = z.infer<typeof runtimeRefSchema>;

export const stdioRuntimeIdentitySchema = z.string().trim().min(1);
export type StdioRuntimeIdentity = z.infer<typeof stdioRuntimeIdentitySchema>;

const runtimeToolIdSchema = z.string().trim().min(1);
const runtimeReadOnlyRoleBlockedToolsSchema = z
  .array(runtimeToolIdSchema)
  .refine((toolIds) => new Set(toolIds).size === toolIds.length, {
    message: "Read-only blocked runtime tool IDs must be unique.",
  });

const runtimeWorkflowToolAliasesSchema = z
  .array(runtimeToolIdSchema)
  .min(1, { message: "Workflow tool alias lists must not be empty." })
  .refine((toolIds) => new Set(toolIds).size === toolIds.length, {
    message: "Workflow tool aliases for a canonical tool must be unique.",
  });

const runtimeWorkflowToolAliasesByCanonicalShape = Object.fromEntries(
  ODT_WORKFLOW_AGENT_TOOL_NAMES.map((toolName) => [
    toolName,
    runtimeWorkflowToolAliasesSchema.optional(),
  ]),
) as Record<AgentToolName, z.ZodOptional<typeof runtimeWorkflowToolAliasesSchema>>;

const runtimeWorkflowToolAliasesByCanonicalSchema = z
  .object(runtimeWorkflowToolAliasesByCanonicalShape)
  .strict()
  .superRefine((aliasesByCanonical, context) => {
    const canonicalByAlias = new Map<string, AgentToolName>();

    for (const canonicalTool of ODT_WORKFLOW_AGENT_TOOL_NAMES) {
      const aliases = aliasesByCanonical[canonicalTool] ?? [];
      for (const [index, alias] of aliases.entries()) {
        if (ODT_WORKFLOW_AGENT_TOOL_NAMES.includes(alias as AgentToolName)) {
          context.addIssue({
            code: "custom",
            path: [canonicalTool, index],
            message: "Runtime workflow aliases must not repeat canonical odt_* tool IDs.",
          });
          continue;
        }

        const existingCanonicalTool = canonicalByAlias.get(alias);
        if (existingCanonicalTool && existingCanonicalTool !== canonicalTool) {
          context.addIssue({
            code: "custom",
            path: [canonicalTool, index],
            message: `Runtime workflow alias "${alias}" is already assigned to canonical tool "${existingCanonicalTool}".`,
          });
          continue;
        }

        canonicalByAlias.set(alias, canonicalTool);
      }
    }
  });

export const runtimeDescriptorSchema = z
  .object({
    kind: runtimeKindSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    readOnlyRoleBlockedTools: runtimeReadOnlyRoleBlockedToolsSchema,
    workflowToolAliasesByCanonical: runtimeWorkflowToolAliasesByCanonicalSchema,
    capabilities: runtimeCapabilitiesSchema,
  })
  .strict();
export type RuntimeDescriptor = z.infer<typeof runtimeDescriptorSchema>;

export const runtimeTransportSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("local_http"),
      endpoint: z.string().trim().min(1),
      workingDirectory: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("stdio"),
      identity: stdioRuntimeIdentitySchema,
      workingDirectory: z.string().trim().min(1),
    })
    .strict(),
]);
export type RuntimeTransport = z.infer<typeof runtimeTransportSchema>;

export const runtimeDescriptorCatalogSchema = z.object({
  runtimes: z.array(runtimeDescriptorSchema),
});
export type RuntimeDescriptorCatalog = z.infer<typeof runtimeDescriptorCatalogSchema>;
