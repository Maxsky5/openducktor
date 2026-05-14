import type {
  TaskCard,
  TaskCreateInput,
  TaskMetadataPayload,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import { loadNamespace, metadataRoot, namespaceMap, writeMetadata } from "./beads-metadata-writer";
import {
  METADATA_NAMESPACE,
  normalizeLabels,
  normalizeTextOption,
  type RunBd,
  type RunBdJson,
} from "./beads-raw-issue";
import {
  appendRawIssueList,
  cutoffDate,
  finalizeTaskCards,
  parseTaskCard,
  parseTaskMetadata,
  rawIssueFromCreatePayload,
  showRawIssue,
} from "./beads-task-mapping";

export const createTaskWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  input: TaskCreateInput,
): Promise<TaskCard> => {
  const args = [
    "create",
    input.title,
    "--type",
    input.issueType,
    "--priority",
    input.priority.toString(),
  ];
  const description = normalizeTextOption(input.description);
  if (description !== undefined) {
    args.push("--description", description);
  }

  const labels = normalizeLabels(input.labels ?? []);
  if (labels.length > 0) {
    args.push("--labels", labels.join(","));
  }

  const parentId = normalizeTextOption(input.parentId);
  if (parentId !== undefined) {
    args.push("--parent", parentId);
  }

  const createdIssue = rawIssueFromCreatePayload(await runBdJson(repoPath, args));
  const root = metadataRoot(createdIssue.metadata);
  const namespace = namespaceMap(root);
  namespace.qaRequired = input.aiReviewEnabled;
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, createdIssue.id, root);

  return parseTaskCard(await showRawIssue(runBdJson, repoPath, createdIssue.id));
};

export const appendLabelUpdateArgs = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  labels: string[],
  args: string[],
): Promise<TaskCard | undefined> => {
  const normalizedLabels = normalizeLabels(labels);
  if (normalizedLabels.length > 0) {
    args.push("--set-labels", normalizedLabels.join(","));
    return undefined;
  }

  const currentTask = parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));
  if (currentTask.labels.length === 0) {
    return currentTask;
  }

  for (const label of currentTask.labels) {
    args.push("--remove-label", label);
  }

  return undefined;
};

export const updateMetadata = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  patch: TaskUpdatePatch,
): Promise<void> => {
  const { root, namespace } = await loadNamespace(runBdJson, repoPath, taskId);
  if (patch.aiReviewEnabled !== undefined) {
    namespace.qaRequired = patch.aiReviewEnabled;
  }
  if (patch.targetBranch !== undefined) {
    namespace.targetBranch = patch.targetBranch;
  }
  root[METADATA_NAMESPACE] = namespace;
  await writeMetadata(runBdJson, repoPath, taskId, root);
};

export const updateTaskWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  patch: TaskUpdatePatch,
): Promise<TaskCard> => {
  const args = ["update"];
  const updatesMetadata = patch.aiReviewEnabled !== undefined || patch.targetBranch !== undefined;
  let currentTaskAfterNoopLabelUpdate: TaskCard | undefined;

  if (patch.title !== undefined) {
    args.push("--title", patch.title);
  }
  if (patch.description !== undefined) {
    args.push("--description", patch.description);
  }
  if (patch.notes !== undefined) {
    args.push("--notes", patch.notes);
  }
  if (patch.priority !== undefined) {
    args.push("--priority", patch.priority.toString());
  }
  if (patch.issueType !== undefined) {
    args.push("--type", patch.issueType);
  }
  if (patch.assignee !== undefined) {
    args.push("--assignee", patch.assignee);
  }
  if (patch.parentId !== undefined) {
    args.push("--parent", patch.parentId.trim());
  }
  if (patch.labels !== undefined) {
    currentTaskAfterNoopLabelUpdate = await appendLabelUpdateArgs(
      runBdJson,
      repoPath,
      taskId,
      patch.labels,
      args,
    );
  }

  if (args.length > 1) {
    await runBdJson(repoPath, [...args, "--", taskId]);
  }

  if (updatesMetadata) {
    await updateMetadata(runBdJson, repoPath, taskId, patch);
  }

  if (currentTaskAfterNoopLabelUpdate && args.length === 1 && !updatesMetadata) {
    return currentTaskAfterNoopLabelUpdate;
  }

  return parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));
};

export const transitionTaskWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  status: TaskStatus,
): Promise<TaskCard> => {
  await runBdJson(repoPath, ["update", "--status", status, "--", taskId]);
  return parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));
};

export const getTaskWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<TaskCard> => parseTaskCard(await showRawIssue(runBdJson, repoPath, taskId));

export const getTaskMetadataWithBd = async (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
): Promise<TaskMetadataPayload> =>
  parseTaskMetadata(await showRawIssue(runBdJson, repoPath, taskId));

export const listTasksWithBd = async (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
  doneVisibleDays: number | undefined,
): Promise<TaskCard[]> => {
  const tasks: TaskCard[] = [];
  const seenTaskIds = new Set<string>();

  if (doneVisibleDays === undefined) {
    appendRawIssueList(
      await runBdJson(repoPath, ["list", "--all", "--limit", "0"]),
      seenTaskIds,
      tasks,
    );
    return finalizeTaskCards(tasks);
  }

  appendRawIssueList(await runBdJson(repoPath, ["list", "--limit", "0"]), seenTaskIds, tasks);

  if (doneVisibleDays > 0) {
    appendRawIssueList(
      await runBdJson(repoPath, [
        "list",
        "--status",
        "closed",
        "--closed-after",
        cutoffDate(now(), doneVisibleDays),
        "--limit",
        "0",
      ]),
      seenTaskIds,
      tasks,
    );
  }

  return finalizeTaskCards(tasks);
};

export const isPullRequestSyncCandidate = (task: TaskCard): boolean =>
  task.status !== "closed" &&
  task.status !== "deferred" &&
  (task.pullRequest?.state === "open" || task.pullRequest?.state === "draft");

export const listPullRequestSyncCandidatesWithBd = async (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
): Promise<TaskCard[]> =>
  (await listTasksWithBd(runBdJson, now, repoPath, undefined)).filter(isPullRequestSyncCandidate);

export const deleteTaskWithBd = async (
  runBd: RunBd,
  repoPath: string,
  taskId: string,
  deleteSubtasks: boolean,
): Promise<boolean> => {
  const args = ["delete", "--force"];
  if (deleteSubtasks) {
    args.push("--cascade");
  }
  args.push("--", taskId);

  await runBd(repoPath, args);
  return true;
};
