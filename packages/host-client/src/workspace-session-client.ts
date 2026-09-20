import {
  workspaceSessionExternalListResultSchema,
  workspaceSessionImportResultSchema,
  type WorkspaceSessionExternalListInput,
  type WorkspaceSessionImportInput,
} from "@openducktor/contracts";
import { z } from "zod";
import {
  type WorkspaceSession,
  type WorkspaceSessionArchiveInput,
  type WorkspaceSessionArchivePreview,
  type AgentSessionModelSelection,
  type WorkspaceSessionStartResult,
  type WorkspaceSessionCreateInput,
  type WorkspaceSessionCreateResult,
  type WorkspaceSessionRefInput,
  workspaceSessionCreateResultSchema,
  workspaceSessionArchivePreviewSchema,
  workspaceSessionSchema,
  workspaceSessionStartResultSchema,
} from "@openducktor/contracts";
import { arrayResultSchema, type InvokeFn } from "./invoke-utils";

export class HostWorkspaceSessionClient {
  constructor(private readonly invoke: InvokeFn) {}

  workspaceSessionExternalList(input: WorkspaceSessionExternalListInput) {
    return this.invoke(
      "workspace_session_external_list",
      input,
      workspaceSessionExternalListResultSchema,
    );
  }
  workspaceSessionExternalRelease(input: { workspaceId: string; catalogRequestId: string }) {
    return this.invoke("workspace_session_external_release", input, z.boolean());
  }
  workspaceSessionImport(input: WorkspaceSessionImportInput) {
    return this.invoke("workspace_session_import", input, workspaceSessionImportResultSchema);
  }

  workspaceSessionListActive(workspaceId: string): Promise<WorkspaceSession[]> {
    return this.invoke(
      "workspace_session_list_active",
      { workspaceId },
      arrayResultSchema(workspaceSessionSchema, "workspace_session_list_active"),
    );
  }

  workspaceSessionListArchived(workspaceId: string): Promise<WorkspaceSession[]> {
    return this.invoke(
      "workspace_session_list_archived",
      { workspaceId },
      arrayResultSchema(workspaceSessionSchema, "workspace_session_list_archived"),
    );
  }

  workspaceSessionGet(input: WorkspaceSessionRefInput): Promise<WorkspaceSession> {
    return this.invoke("workspace_session_get", input, workspaceSessionSchema);
  }

  workspaceSessionCreate(
    input: WorkspaceSessionCreateInput,
  ): Promise<WorkspaceSessionCreateResult> {
    return this.invoke("workspace_session_create", input, workspaceSessionCreateResultSchema);
  }

  workspaceSessionStart(input: WorkspaceSessionRefInput): Promise<WorkspaceSessionStartResult> {
    return this.invoke("workspace_session_start", input, workspaceSessionStartResultSchema);
  }

  workspaceSessionSetDraftModel(
    input: WorkspaceSessionRefInput & { selectedModel: AgentSessionModelSelection },
  ): Promise<WorkspaceSession> {
    return this.invoke("workspace_session_set_draft_model", input, workspaceSessionSchema);
  }

  workspaceSessionRename(
    input: WorkspaceSessionRefInput & { manualTitle: string | null },
  ): Promise<WorkspaceSession> {
    return this.invoke("workspace_session_rename", input, workspaceSessionSchema);
  }

  workspaceSessionArchive(input: WorkspaceSessionArchiveInput): Promise<WorkspaceSession> {
    return this.invoke("workspace_session_archive", input, workspaceSessionSchema);
  }

  workspaceSessionArchivePreview(
    input: WorkspaceSessionRefInput,
  ): Promise<WorkspaceSessionArchivePreview> {
    return this.invoke(
      "workspace_session_archive_preview",
      input,
      workspaceSessionArchivePreviewSchema,
    );
  }

  workspaceSessionRestore(input: WorkspaceSessionRefInput): Promise<WorkspaceSession> {
    return this.invoke("workspace_session_restore", input, workspaceSessionSchema);
  }
}
