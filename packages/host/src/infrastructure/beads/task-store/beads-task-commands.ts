import type {
  TaskCard,
  TaskCreateInput,
  TaskStatus,
  TaskUpdatePatch,
} from "@openducktor/contracts";
import { Effect } from "effect";
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
export const createTaskWithBd = (runBdJson: RunBdJson, repoPath: string, input: TaskCreateInput) =>
  Effect.gen(function* () {
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
    const createdIssue = rawIssueFromCreatePayload(yield* runBdJson(repoPath, args));
    const root = metadataRoot(createdIssue.metadata);
    const namespace = namespaceMap(root);
    namespace.qaRequired = input.aiReviewEnabled;
    root[METADATA_NAMESPACE] = namespace;
    yield* writeMetadata(runBdJson, repoPath, createdIssue.id, root);
    const issue = yield* showRawIssue(runBdJson, repoPath, createdIssue.id);
    return parseTaskCard(issue);
  });
export const appendLabelUpdateArgs = (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  labels: string[],
  args: string[],
) =>
  Effect.gen(function* () {
    const normalizedLabels = normalizeLabels(labels);
    if (normalizedLabels.length > 0) {
      args.push("--set-labels", normalizedLabels.join(","));
      return undefined;
    }
    const currentIssue = yield* showRawIssue(runBdJson, repoPath, taskId);
    const currentTask = parseTaskCard(currentIssue);
    if (currentTask.labels.length === 0) {
      return currentTask;
    }
    for (const label of currentTask.labels) {
      args.push("--remove-label", label);
    }
    return undefined;
  });
export const updateMetadata = (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  patch: TaskUpdatePatch,
) =>
  Effect.gen(function* () {
    const { root, namespace } = yield* loadNamespace(runBdJson, repoPath, taskId);
    if (patch.aiReviewEnabled !== undefined) {
      namespace.qaRequired = patch.aiReviewEnabled;
    }
    if (patch.targetBranch !== undefined) {
      namespace.targetBranch = patch.targetBranch;
    }
    root[METADATA_NAMESPACE] = namespace;
    yield* writeMetadata(runBdJson, repoPath, taskId, root);
  });
export const updateTaskWithBd = (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  patch: TaskUpdatePatch,
) =>
  Effect.gen(function* () {
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
      currentTaskAfterNoopLabelUpdate = yield* appendLabelUpdateArgs(
        runBdJson,
        repoPath,
        taskId,
        patch.labels,
        args,
      );
    }
    if (args.length > 1) {
      yield* runBdJson(repoPath, [...args, "--", taskId]);
    }
    if (updatesMetadata) {
      yield* updateMetadata(runBdJson, repoPath, taskId, patch);
    }
    if (currentTaskAfterNoopLabelUpdate && args.length === 1 && !updatesMetadata) {
      return currentTaskAfterNoopLabelUpdate;
    }
    const issue = yield* showRawIssue(runBdJson, repoPath, taskId);
    return parseTaskCard(issue);
  });
export const transitionTaskWithBd = (
  runBdJson: RunBdJson,
  repoPath: string,
  taskId: string,
  status: TaskStatus,
) =>
  Effect.gen(function* () {
    yield* runBdJson(repoPath, ["update", "--status", status, "--", taskId]);
    const issue = yield* showRawIssue(runBdJson, repoPath, taskId);
    return parseTaskCard(issue);
  });
export const getTaskWithBd = (runBdJson: RunBdJson, repoPath: string, taskId: string) =>
  Effect.gen(function* () {
    const issue = yield* showRawIssue(runBdJson, repoPath, taskId);
    return parseTaskCard(issue);
  });
export const getTaskMetadataWithBd = (runBdJson: RunBdJson, repoPath: string, taskId: string) =>
  Effect.gen(function* () {
    const issue = yield* showRawIssue(runBdJson, repoPath, taskId);
    return parseTaskMetadata(issue);
  });
export const listTasksWithBd = (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
  doneVisibleDays: number | undefined,
) =>
  Effect.gen(function* () {
    const tasks: TaskCard[] = [];
    const seenTaskIds = new Set<string>();
    if (doneVisibleDays === undefined) {
      appendRawIssueList(
        yield* runBdJson(repoPath, ["list", "--all", "--limit", "0"]),
        seenTaskIds,
        tasks,
      );
      return finalizeTaskCards(tasks);
    }
    appendRawIssueList(yield* runBdJson(repoPath, ["list", "--limit", "0"]), seenTaskIds, tasks);
    if (doneVisibleDays > 0) {
      appendRawIssueList(
        yield* runBdJson(repoPath, [
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
  });
export const isPullRequestSyncCandidate = (task: TaskCard): boolean =>
  task.status !== "closed" &&
  task.status !== "deferred" &&
  (task.pullRequest?.state === "open" || task.pullRequest?.state === "draft");
export const listPullRequestSyncCandidatesWithBd = (
  runBdJson: RunBdJson,
  now: () => Date,
  repoPath: string,
) =>
  Effect.gen(function* () {
    const tasks = yield* listTasksWithBd(runBdJson, now, repoPath, undefined);
    return tasks.filter(isPullRequestSyncCandidate);
  });
export const deleteTaskWithBd = (
  runBd: RunBd,
  repoPath: string,
  taskId: string,
  deleteSubtasks: boolean,
) =>
  Effect.gen(function* () {
    const args = ["delete", "--force"];
    if (deleteSubtasks) {
      args.push("--cascade");
    }
    args.push("--", taskId);
    yield* runBd(repoPath, args);
    return true;
  });
