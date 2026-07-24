import type { TaskCreateInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { encodeJson, normalizeLabels } from "./sqlite-json-codecs";
import {
  firstTaskIdHashLength,
  taskIdCandidates,
  taskIdExhaustedError,
  taskIdPrefixForWorkspaceId,
} from "./sqlite-task-ids";
import type { TaskInsert, TaskStoreSession } from "./sqlite-task-store-schema";
import { insertTaskIfAbsent } from "./sqlite-task-writes";

const taskInsertFromCreateInput = (
  task: TaskCreateInput,
  taskId: string,
  createdAt: Date,
): TaskInsert => ({
  agentSessionsJson: encodeJson([]),
  createdAt,
  description: task.description ?? null,
  directMergeJson: null,
  id: taskId,
  issueType: task.issueType ?? "task",
  labelsJson: encodeJson(normalizeLabels(task.labels ?? [])),
  parentId: task.parentId ?? null,
  priority: task.priority ?? 2,
  pullRequestJson: null,
  qaRequired: task.aiReviewEnabled === false ? 0 : 1,
  status: "open",
  targetBranchJson: null,
  title: task.title,
  updatedAt: createdAt,
});

export const insertTaskFromCreateInput = ({
  createdAt,
  session,
  task,
  workspaceId,
}: {
  createdAt: Date;
  session: TaskStoreSession;
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
      if (yield* insertTaskIfAbsent(session, taskInsertFromCreateInput(task, taskId, createdAt))) {
        return taskId;
      }
    }
    return yield* taskIdExhaustedError(prefix);
  });
