import type { TaskCreateInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizeLabels } from "../../domain/task/task-labels";
import { encodeJson } from "./sqlite-json-codecs";
import {
  firstTaskIdHashLength,
  taskIdCandidates,
  taskIdExhaustedError,
  taskIdPrefixForWorkspaceId,
} from "./sqlite-task-ids";
import type { TaskInsert, TaskStoreSession } from "./sqlite-task-store-schema";
import { insertTaskIfAbsent } from "./sqlite-task-writes";

export const taskInsertFromCreateInput = (
  task: TaskCreateInput,
  status: string,
  taskId: string,
  createdAt: Date,
): TaskInsert => ({
  agentSessionsJson: encodeJson([]),
  createdAt,
  description: task.description ?? null,
  directMergeJson: null,
  id: taskId,
  issueType: task.issueType,
  labelsJson: encodeJson(normalizeLabels(task.labels ?? [])),
  priority: task.priority,
  pullRequestJson: null,
  status,
  targetBranchJson: null,
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
  session: TaskStoreSession;
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
          taskInsertFromCreateInput(task, status, taskId, createdAt),
        )
      ) {
        return taskId;
      }
    }
    return yield* taskIdExhaustedError(prefix);
  });
