import {
  workflowDocumentViewSchema,
  workflowDraftDiscardResultSchema,
  workflowExportSchema,
  workflowIdResultSchema,
  workflowImportPreviewSchema,
  workflowLibraryInputSchemas,
  workflowLibrarySchema,
  workflowPublishResultSchema,
  workflowRoleImpactSchema,
  workflowRoleSaveResultSchema,
  workflowTaskUseSchema,
  workflowTaskMoveGroupsSchema,
  workflowTasksMoveResultSchema,
  workflowVersionListSchema,
  type WorkflowDocumentView,
  type WorkflowExport,
  type WorkflowImportPreview,
  type WorkflowLibrary,
  type WorkflowLibraryInputs,
  type WorkflowPublishResult,
  type WorkflowRoleImpact,
  type WorkflowRoleSaveResult,
  type WorkflowTaskUse,
  type WorkflowTaskMoveGroup,
  type WorkflowVersionSummary,
} from "@openducktor/contracts";
import { type InvokeFn, voidResultSchema } from "./invoke-utils";

const inputs = workflowLibraryInputSchemas;

/** The commands of the workflow library: workflows, drafts, versions, roles, and enablement. */
export class HostWorkflowLibraryClient {
  constructor(private readonly invokeFn: InvokeFn) {}

  workflowLibraryList(): Promise<WorkflowLibrary> {
    return this.invokeFn("workflow_library_list", {}, workflowLibrarySchema);
  }

  workflowDocumentGet(
    input: WorkflowLibraryInputs["workflow_document_get"],
  ): Promise<WorkflowDocumentView> {
    return this.invokeFn(
      "workflow_document_get",
      inputs.workflow_document_get.parse(input),
      workflowDocumentViewSchema,
    );
  }

  workflowVersionsList(
    input: WorkflowLibraryInputs["workflow_versions_list"],
  ): Promise<WorkflowVersionSummary[]> {
    return this.invokeFn(
      "workflow_versions_list",
      inputs.workflow_versions_list.parse(input),
      workflowVersionListSchema,
    );
  }

  workflowTaskUseGet(
    input: WorkflowLibraryInputs["workflow_task_use_get"],
  ): Promise<WorkflowTaskUse> {
    return this.invokeFn(
      "workflow_task_use_get",
      inputs.workflow_task_use_get.parse(input),
      workflowTaskUseSchema,
    );
  }

  workflowTaskMovesGet(
    input: WorkflowLibraryInputs["workflow_task_moves_get"],
  ): Promise<WorkflowTaskMoveGroup[]> {
    return this.invokeFn(
      "workflow_task_moves_get",
      inputs.workflow_task_moves_get.parse(input),
      workflowTaskMoveGroupsSchema,
    );
  }

  workflowRoleImpactGet(
    input: WorkflowLibraryInputs["workflow_role_impact_get"],
  ): Promise<WorkflowRoleImpact> {
    return this.invokeFn(
      "workflow_role_impact_get",
      inputs.workflow_role_impact_get.parse(input),
      workflowRoleImpactSchema,
    );
  }

  workflowExport(input: WorkflowLibraryInputs["workflow_export"]): Promise<WorkflowExport> {
    return this.invokeFn(
      "workflow_export",
      inputs.workflow_export.parse(input),
      workflowExportSchema,
    );
  }

  workflowImportPreview(
    input: WorkflowLibraryInputs["workflow_import_preview"],
  ): Promise<WorkflowImportPreview> {
    return this.invokeFn(
      "workflow_import_preview",
      inputs.workflow_import_preview.parse(input),
      workflowImportPreviewSchema,
    );
  }

  workflowCreate(input: WorkflowLibraryInputs["workflow_create"]): Promise<{ workflowId: string }> {
    return this.invokeFn(
      "workflow_create",
      inputs.workflow_create.parse(input),
      workflowIdResultSchema,
    );
  }

  workflowDraftSave(
    input: WorkflowLibraryInputs["workflow_draft_save"],
  ): Promise<{ workflowId: string }> {
    return this.invokeFn(
      "workflow_draft_save",
      inputs.workflow_draft_save.parse(input),
      workflowIdResultSchema,
    );
  }

  workflowDraftDiscard(
    input: WorkflowLibraryInputs["workflow_draft_discard"],
  ): Promise<{ workflowDeleted: boolean }> {
    return this.invokeFn(
      "workflow_draft_discard",
      inputs.workflow_draft_discard.parse(input),
      workflowDraftDiscardResultSchema,
    );
  }

  workflowPublish(
    input: WorkflowLibraryInputs["workflow_publish"],
  ): Promise<WorkflowPublishResult> {
    return this.invokeFn(
      "workflow_publish",
      inputs.workflow_publish.parse(input),
      workflowPublishResultSchema,
    );
  }

  workflowTasksMove(
    input: WorkflowLibraryInputs["workflow_tasks_move"],
  ): Promise<{ moved: number }> {
    return this.invokeFn(
      "workflow_tasks_move",
      inputs.workflow_tasks_move.parse(input),
      workflowTasksMoveResultSchema,
    );
  }

  async workflowDelete(input: WorkflowLibraryInputs["workflow_delete"]): Promise<void> {
    await this.invokeFn("workflow_delete", inputs.workflow_delete.parse(input), voidResultSchema);
  }

  workflowImportCommit(
    input: WorkflowLibraryInputs["workflow_import_commit"],
  ): Promise<{ workflowId: string }> {
    return this.invokeFn(
      "workflow_import_commit",
      inputs.workflow_import_commit.parse(input),
      workflowIdResultSchema,
    );
  }

  workflowRoleSave(
    input: WorkflowLibraryInputs["workflow_role_save"],
  ): Promise<WorkflowRoleSaveResult> {
    return this.invokeFn(
      "workflow_role_save",
      inputs.workflow_role_save.parse(input),
      workflowRoleSaveResultSchema,
    );
  }

  async workflowRoleDelete(input: WorkflowLibraryInputs["workflow_role_delete"]): Promise<void> {
    await this.invokeFn(
      "workflow_role_delete",
      inputs.workflow_role_delete.parse(input),
      voidResultSchema,
    );
  }

  async workflowAvailabilitySet(
    input: WorkflowLibraryInputs["workflow_availability_set"],
  ): Promise<void> {
    await this.invokeFn(
      "workflow_availability_set",
      inputs.workflow_availability_set.parse(input),
      voidResultSchema,
    );
  }

  async workflowDefaultSet(input: WorkflowLibraryInputs["workflow_default_set"]): Promise<void> {
    await this.invokeFn(
      "workflow_default_set",
      inputs.workflow_default_set.parse(input),
      voidResultSchema,
    );
  }
}
