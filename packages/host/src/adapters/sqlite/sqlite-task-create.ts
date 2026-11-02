import type { TaskCreateInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizeLabels } from "../../domain/task/task-labels";
import { replaceTaskLabels } from "./sqlite-task-relations";
import {
  firstTaskIdHashLength,
  taskIdCandidates,
  taskIdExhaustedError,
  taskIdPrefixForWorkspaceId,
} from "./sqlite-task-ids";
import type { TaskInsert, HostDatabaseSession } from "./sqlite-host-database-schema";
import { insertTaskIfAbsent } from "./sqlite-task-writes";

const taskInsertFromCreateInput = (
  task: TaskCreateInput,
  status: string,
  taskId: string,
  createdAt: Date,
  workspaceId: string,
): TaskInsert => ({
  workspaceId,
  createdAt,
  description: task.description ?? null,
  id: taskId,
  issueType: task.issueType,
  priority: task.priority,
  removeWorktreeOnClose: task.removeWorktreeOnClose ?? null,
  status,
  targetBranch: null,
  targetRemote: null,
  title: task.title,
  updatedAt: createdAt,
});

export const insertTaskFromCreateInput = ({
  createdAt,
  session,
  status,
  task,
  workspaceId,
}: {
  createdAt: Date;
  session: HostDatabaseSession;
  status: string;
  task: TaskCreateInput;
  workspaceId: string;
}) =>
  Effect.gen(function* () {
    const prefix = taskIdPrefixForWorkspaceId(workspaceId);
    const firstLength = yield* firstTaskIdHashLength(session, prefix);
    const candidates = taskIdCandidates({
      createdAt,
      description: task.description,
      firstLength,
      prefix,
      title: task.title,
    });
    for (const taskId of candidates) {
      if (
        yield* insertTaskIfAbsent(
          session,
          workspaceId,
          taskInsertFromCreateInput(task, status, taskId, createdAt, workspaceId),
        )
      ) {
        yield* replaceTaskLabels(session, workspaceId, taskId, normalizeLabels(task.labels ?? []));
        return taskId;
      }
    }
    return yield* taskIdExhaustedError(prefix);
  });
