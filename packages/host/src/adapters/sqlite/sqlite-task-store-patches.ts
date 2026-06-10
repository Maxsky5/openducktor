import { gitTargetBranchSchema } from "@openducktor/contracts";
import type { SqliteDatabase, SqliteValue } from "../../infrastructure/sqlite/sqlite-driver";
import type { TaskStorePort } from "../../ports/task-repository-ports";
import { encodeJson, getTaskCard, normalizeLabels } from "./sqlite-task-store-records";

const appendTaskPatch = (
  updates: string[],
  params: SqliteValue[],
  fieldSql: string,
  value: SqliteValue,
): void => {
  updates.push(fieldSql);
  params.push(value);
};

export const applyTaskPatch = (
  database: SqliteDatabase,
  input: Parameters<TaskStorePort["updateTask"]>[0],
  updatedAtMs: number,
) => {
  const updates: string[] = [];
  const params: SqliteValue[] = [];
  if (input.patch.title !== undefined) {
    appendTaskPatch(updates, params, "title = ?", input.patch.title);
  }
  if (input.patch.description !== undefined) {
    appendTaskPatch(updates, params, "description = ?", input.patch.description);
  }
  if (input.patch.notes !== undefined) {
    appendTaskPatch(updates, params, "notes = ?", input.patch.notes);
  }
  if (input.patch.priority !== undefined) {
    appendTaskPatch(updates, params, "priority = ?", input.patch.priority);
  }
  if (input.patch.issueType !== undefined) {
    appendTaskPatch(updates, params, "issue_type = ?", input.patch.issueType);
  }
  if (input.patch.aiReviewEnabled !== undefined) {
    appendTaskPatch(updates, params, "qa_required = ?", input.patch.aiReviewEnabled ? 1 : 0);
  }
  if (input.patch.labels !== undefined) {
    appendTaskPatch(
      updates,
      params,
      "labels_json = ?",
      encodeJson(normalizeLabels(input.patch.labels)),
    );
  }
  if (input.patch.parentId !== undefined) {
    const parentId = input.patch.parentId.trim();
    appendTaskPatch(updates, params, "parent_id = ?", parentId.length > 0 ? parentId : null);
  }
  if (input.patch.targetBranch !== undefined) {
    appendTaskPatch(
      updates,
      params,
      "target_branch_json = ?",
      encodeJson(gitTargetBranchSchema.parse(input.patch.targetBranch)),
    );
  }
  if (updates.length > 0) {
    appendTaskPatch(updates, params, "updated_at_ms = ?", updatedAtMs);
    database
      .prepare(`update tasks set ${updates.join(", ")} where id = ?`)
      .run(...params, input.taskId);
  }
  return getTaskCard(database, input.taskId, input.repoPath);
};
