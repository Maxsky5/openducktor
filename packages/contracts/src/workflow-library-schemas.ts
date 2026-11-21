import { z } from "zod";
import { agentPromptPlaceholderSchema } from "./prompt-schemas";
import { workflowIdSchema } from "./workflow-condition-schemas";
import { agentRoleDefinitionSchema, workflowDefinitionSchema } from "./workflow-definition-schemas";
import { workflowIconSchema, workflowToneSchema } from "./workflow-display-schemas";

/** Where a workflow or a catalog role comes from. */
export const workflowSourceSchema = z.enum(["builtin", "custom"]);
export type WorkflowSource = z.infer<typeof workflowSourceSchema>;

/**
 * The workflow content of a draft, a file, and the editor. A task workflow derives only the
 * `issueType` fact, so a document has no facts. The host sets the format and the revision.
 */
export const workflowDocumentDefinitionSchema = workflowDefinitionSchema.omit({
  schemaVersion: true,
  revision: true,
  facts: true,
});
export type WorkflowDocumentDefinition = z.infer<typeof workflowDocumentDefinitionSchema>;

const canvasPositionSchema = z.strictObject({ x: z.number().int(), y: z.number().int() });

export const workflowCanvasLayoutSchema = z.strictObject({
  /** Box positions by state ID, in whole canvas pixels. */
  states: z.record(z.string(), canvasPositionSchema),
});
export type WorkflowCanvasLayout = z.infer<typeof workflowCanvasLayoutSchema>;

export const workflowPromptPurposeSchema = z.enum([
  "system",
  "kickoff",
  "message",
  "permission",
  "goal",
]);
export type WorkflowPromptPurpose = z.infer<typeof workflowPromptPurposeSchema>;

/** A workflow prompt of a document. A version adds the built-in version of each prompt. */
export const workflowPromptSchema = z.strictObject({
  id: workflowIdSchema,
  purpose: workflowPromptPurposeSchema,
  label: z.string(),
  description: z.string(),
  requiredPlaceholders: z.array(agentPromptPlaceholderSchema).optional(),
  template: z.string(),
});
export type WorkflowPrompt = z.infer<typeof workflowPromptSchema>;

/** A draft, an import, or the editable form of a version. Problems never stop a save. */
export const workflowDocumentSchema = z.strictObject({
  definition: workflowDocumentDefinitionSchema,
  prompts: z.array(workflowPromptSchema),
  layout: workflowCanvasLayoutSchema,
});
export type WorkflowDocument = z.infer<typeof workflowDocumentSchema>;

export const workflowVersionPromptSchema = workflowPromptSchema.extend({
  builtinVersion: z.number().int().positive(),
});
export type WorkflowVersionPrompt = z.infer<typeof workflowVersionPromptSchema>;

/** A published version. It never changes. `definition.revision` is the version number. */
export const workflowVersionDocumentSchema = z.strictObject({
  definition: workflowDefinitionSchema,
  prompts: z.array(workflowVersionPromptSchema),
  layout: workflowCanvasLayoutSchema,
});
export type WorkflowVersionDocument = z.infer<typeof workflowVersionDocumentSchema>;

const problemPathSchema = z.array(z.union([z.string(), z.number().int().nonnegative()]));

/** A content problem of a workflow document or of a role input. Errors block publication. */
export const workflowProblemSchema = z.strictObject({
  severity: z.enum(["error", "warning"]),
  /** Field path in the workflow document or in the role input. */
  path: problemPathSchema,
  message: z.string().min(1),
});
export type WorkflowProblem = z.infer<typeof workflowProblemSchema>;
export type WorkflowProblemPath = WorkflowProblem["path"];

/** The role form and the YAML file: a catalog role with instructions instead of `systemPrompt`. */
export const workflowRoleInputSchema = agentRoleDefinitionSchema
  .omit({ systemPrompt: true })
  .extend({ instructions: z.string() });
export type WorkflowRoleInput = z.infer<typeof workflowRoleInputSchema>;

export const WORKFLOW_FILE_FORMAT_VERSION = 1;

/** One shared workflow. It holds no settings, tasks, or history. */
export const workflowFileSchema = z.strictObject({
  formatVersion: z.literal(WORKFLOW_FILE_FORMAT_VERSION),
  workflow: workflowDocumentDefinitionSchema,
  prompts: z.array(workflowPromptSchema),
  /** Only the custom roles that the workflow binds. Built-in roles appear only by ID. */
  roles: z.array(workflowRoleInputSchema),
  layout: workflowCanvasLayoutSchema,
});
export type WorkflowFile = z.infer<typeof workflowFileSchema>;

/** A board column of a workflow, for the overview of the workflow list. */
export const workflowLibraryStateSchema = z.strictObject({
  id: workflowIdSchema,
  label: z.string(),
  tone: workflowToneSchema.optional(),
});
export type WorkflowLibraryState = z.infer<typeof workflowLibraryStateSchema>;

/**
 * The workspaces that can use a workflow: every workspace, only the listed ones, or every one but
 * the listed ones. A workspace added later follows the rule.
 */
export const workflowAvailabilitySchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("all") }),
  z.strictObject({
    mode: z.enum(["only", "except"]),
    workspaceIds: z.array(z.string().min(1)),
  }),
]);
export type WorkflowAvailability = z.infer<typeof workflowAvailabilitySchema>;

export const workflowLibraryEntrySchema = z.strictObject({
  id: workflowIdSchema,
  name: z.string(),
  /** The board columns of the draft, else of the latest version, in board order. */
  states: z.array(workflowLibraryStateSchema),
  transitionCount: z.number().int().nonnegative(),
  source: workflowSourceSchema,
  /** Null for the built-in workflow and for a workflow without a version. */
  latestVersion: z.number().int().positive().nullable(),
  /** The draft check: errors stop a publication, warnings are things to check. */
  draft: z
    .strictObject({
      problemCount: z.number().int().nonnegative(),
      warningCount: z.number().int().nonnegative(),
    })
    .nullable(),
  availability: workflowAvailabilitySchema,
});
export type WorkflowLibraryEntry = z.infer<typeof workflowLibraryEntrySchema>;

export const workflowLibraryRoleSchema = z.strictObject({
  role: agentRoleDefinitionSchema,
  source: workflowSourceSchema,
  /** The workflows whose latest version or draft binds the role. */
  workflowIds: z.array(workflowIdSchema),
});
export type WorkflowLibraryRole = z.infer<typeof workflowLibraryRoleSchema>;

export const workflowLibrarySchema = z.strictObject({
  workflows: z.array(workflowLibraryEntrySchema),
  roles: z.array(workflowLibraryRoleSchema),
  /** The workflow of a new task. Every workspace can use it. */
  defaultWorkflowId: workflowIdSchema,
});
export type WorkflowLibrary = z.infer<typeof workflowLibrarySchema>;

export const workflowDocumentViewSchema = z.strictObject({
  workflowId: workflowIdSchema,
  source: workflowSourceSchema,
  /** A draft, or a fixed document: a published version or the built-in workflow. */
  kind: z.enum(["draft", "version"]),
  /** The version that the view shows. Null for the built-in workflow and for a draft. */
  version: z.number().int().positive().nullable(),
  latestVersion: z.number().int().positive().nullable(),
  document: workflowDocumentSchema,
});
export type WorkflowDocumentView = z.infer<typeof workflowDocumentViewSchema>;

export const workflowVersionSummarySchema = z.strictObject({
  version: z.number().int().positive(),
  publishedAt: z.string(),
  taskCount: z.number().int().nonnegative(),
});
export type WorkflowVersionSummary = z.infer<typeof workflowVersionSummarySchema>;
export const workflowVersionListSchema = z.array(workflowVersionSummarySchema);

export const workflowTaskMoveGroupSchema = z.strictObject({
  workspaceId: z.string().min(1),
  repoName: z.string(),
  /** `blocked` is null for a task that can move, else the reason. */
  tasks: z.array(
    z.strictObject({
      taskId: z.string().min(1),
      title: z.string(),
      status: z.string(),
      version: z.number().int().positive(),
      blocked: z.string().nullable(),
    }),
  ),
});
export type WorkflowTaskMoveGroup = z.infer<typeof workflowTaskMoveGroupSchema>;
export const workflowTaskMoveGroupsSchema = z.array(workflowTaskMoveGroupSchema);

/** The tasks of one repository that use a workflow, closed tasks included. */
/** The open tasks of a workflow in one repository, each with its type and state in its version. */
export const workflowTaskGroupSchema = z.strictObject({
  workspaceId: z.string().min(1),
  repoName: z.string(),
  tasks: z.array(
    z.strictObject({
      taskId: z.string().min(1),
      title: z.string(),
      version: z.number().int().positive(),
      issueType: z.strictObject({
        id: z.string(),
        label: z.string(),
        icon: workflowIconSchema.optional(),
      }),
      state: workflowLibraryStateSchema,
    }),
  ),
});
export type WorkflowTaskGroup = z.infer<typeof workflowTaskGroupSchema>;

/** The tasks that use a workflow. Open tasks stop a delete. A delete keeps the versions of closed tasks. */
export const workflowTaskUseSchema = z.strictObject({
  openTasks: z.array(workflowTaskGroupSchema),
  closedTaskCount: z.number().int().nonnegative(),
});
export type WorkflowTaskUse = z.infer<typeof workflowTaskUseSchema>;

export const workflowRoleImpactSchema = z.strictObject({
  /** The workflows whose published versions bind the role. */
  workflows: z.array(z.strictObject({ id: workflowIdSchema, name: z.string() })),
  /** The running sessions of the role on this host. */
  runningSessions: z.number().int().nonnegative(),
});
export type WorkflowRoleImpact = z.infer<typeof workflowRoleImpactSchema>;

export const workflowExportSchema = z.strictObject({
  fileName: z.string().min(1),
  text: z.string(),
});
export type WorkflowExport = z.infer<typeof workflowExportSchema>;

export const workflowImportRoleStatusSchema = z.enum(["create", "reuse", "conflict"]);
export type WorkflowImportRoleStatus = z.infer<typeof workflowImportRoleStatusSchema>;

export const workflowImportPreviewSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("invalid"),
    message: z.string().min(1),
    line: z.number().int().positive().nullable(),
    column: z.number().int().positive().nullable(),
  }),
  z.strictObject({
    outcome: z.literal("ready"),
    name: z.string(),
    workflowId: workflowIdSchema,
    match: z.enum(["none", "builtin", "custom"]),
    existingDraft: z.boolean(),
    /** The custom roles of the file and what the import does with each. */
    roles: z.array(
      z.strictObject({ id: workflowIdSchema, status: workflowImportRoleStatusSchema }),
    ),
  }),
]);
export type WorkflowImportPreview = z.infer<typeof workflowImportPreviewSchema>;

export const workflowPublishResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("published"), version: z.number().int().positive() }),
  z.strictObject({ outcome: z.literal("problems"), problems: z.array(workflowProblemSchema) }),
]);
export type WorkflowPublishResult = z.infer<typeof workflowPublishResultSchema>;

export const workflowRoleSaveResultSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("saved"), role: agentRoleDefinitionSchema }),
  z.strictObject({ outcome: z.literal("problems"), problems: z.array(workflowProblemSchema) }),
]);
export type WorkflowRoleSaveResult = z.infer<typeof workflowRoleSaveResultSchema>;

const taskRefSchema = z.strictObject({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
});
export type WorkflowTaskRef = z.infer<typeof taskRefSchema>;

/** The inputs of the workflow library commands. */
export const workflowLibraryInputSchemas = {
  workflow_library_list: z.strictObject({}),
  workflow_document_get: z.strictObject({
    workflowId: workflowIdSchema,
    version: z.number().int().positive().optional(),
  }),
  workflow_versions_list: z.strictObject({ workflowId: workflowIdSchema }),
  workflow_task_use_get: z.strictObject({ workflowId: workflowIdSchema }),
  workflow_task_moves_get: z.strictObject({
    workflowId: workflowIdSchema,
    target: z.enum(["draft", "latest"]),
  }),
  workflow_role_impact_get: z.strictObject({ roleId: workflowIdSchema }),
  workflow_export: z.strictObject({ workflowId: workflowIdSchema }),
  workflow_import_preview: z.strictObject({ text: z.string() }),
  workflow_create: z.union([
    /** A new workflow with the core states only. */
    z.strictObject({ name: z.string().trim().min(1) }),
    /** A copy of a workflow. Without a name, the copy takes the name of the source plus " copy". */
    z.strictObject({ from: workflowIdSchema, name: z.string().trim().min(1).optional() }),
  ]),
  workflow_draft_save: z.strictObject({
    workflowId: workflowIdSchema,
    document: workflowDocumentSchema,
  }),
  workflow_draft_discard: z.strictObject({ workflowId: workflowIdSchema }),
  workflow_publish: z.strictObject({
    workflowId: workflowIdSchema,
    moveTasks: z.array(taskRefSchema),
  }),
  workflow_tasks_move: z.strictObject({
    workflowId: workflowIdSchema,
    tasks: z.array(taskRefSchema),
  }),
  workflow_delete: z.strictObject({ workflowId: workflowIdSchema }),
  workflow_import_commit: z.strictObject({
    text: z.string(),
    target: z.enum(["new", "update"]),
    /** For each conflicting role ID: keep the host role, or import the file role with a new ID. */
    roleChoices: z.record(z.string(), z.enum(["host", "new"])),
  }),
  workflow_role_save: z.strictObject({
    role: workflowRoleInputSchema,
    mode: z.enum(["create", "update"]),
  }),
  workflow_role_delete: z.strictObject({ roleId: workflowIdSchema }),
  workflow_availability_set: z.strictObject({
    workflowId: workflowIdSchema,
    availability: workflowAvailabilitySchema,
  }),
  workflow_default_set: z.strictObject({ workflowId: workflowIdSchema }),
} as const;

export type WorkflowLibraryInputs = {
  [Command in keyof typeof workflowLibraryInputSchemas]: z.input<
    (typeof workflowLibraryInputSchemas)[Command]
  >;
};

export const workflowIdResultSchema = z.strictObject({ workflowId: workflowIdSchema });
export const workflowDraftDiscardResultSchema = z.strictObject({ workflowDeleted: z.boolean() });
export const workflowTasksMoveResultSchema = z.strictObject({
  moved: z.number().int().nonnegative(),
});
