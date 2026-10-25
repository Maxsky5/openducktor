import {
  CreateTaskInputSchema,
  createTaskResultSchema,
  type PublicTaskSummaryTask,
  SearchTasksInputSchema,
  searchTasksResultSchema,
  taskSummarySchema,
} from "@openducktor/contracts";
import type { ZodType } from "zod";
import type { AgentChatTaskToolName } from "../send/agent-chat.types";
import type { ToolMeta } from "./agent-chat-message-card-model.types";
import { getToolLifecyclePhase } from "./tool-lifecycle";

const readTaskToolResult = <Result>(
  schema: ZodType<Result>,
  output: string | undefined,
): Result | null => {
  if (!output) return null;
  try {
    const result = schema.safeParse(JSON.parse(output));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
};

const taskSearchSummary = (meta: ToolMeta): string => {
  const input = SearchTasksInputSchema.safeParse(meta.input);
  const filters: string[] = [];
  if (input.success) {
    const { title, status, issueType, priority, tags, limit } = input.data;
    if (title) filters.push(`title: ${title}`);
    if (status) filters.push(`status: ${status}`);
    if (issueType) filters.push(`type: ${issueType}`);
    if (priority !== undefined) filters.push(`priority: P${priority}`);
    if (tags) filters.push(`tags: ${tags.join(", ")}`);
    filters.push(`limit: ${limit}`);
  } else {
    filters.push(meta.input ? "Invalid search filters" : "Waiting for filters");
  }
  const phase = getToolLifecyclePhase(meta);
  if (phase === "completed") {
    const result = readTaskToolResult(searchTasksResultSchema, meta.output);
    if (result) {
      const { totalCount, results } = result;
      const count = `${totalCount} ${totalCount === 1 ? "result" : "results"}`;
      filters.unshift(results.length < totalCount ? `${count}, ${results.length} returned` : count);
    } else {
      filters.push("Invalid search result");
    }
  }
  if (phase === "failed") filters.push(meta.error || "Tool failed");
  if (phase === "cancelled") filters.push("Tool cancelled");
  return filters.join(" · ");
};

/** The task that a completed create or update call returned, or null. */
export const resolveTaskToolTask = (
  tool: AgentChatTaskToolName,
  meta: ToolMeta,
): PublicTaskSummaryTask | null => {
  if (getToolLifecyclePhase(meta) !== "completed") return null;
  if (tool === "create_task") {
    return readTaskToolResult(createTaskResultSchema, meta.output)?.task ?? null;
  }
  if (tool === "update_task") {
    return readTaskToolResult(taskSummarySchema, meta.output)?.task ?? null;
  }
  return null;
};

/** The summary of a task tool call: search filters and results, or the task title. */
export const buildTaskToolSummary = (
  tool: AgentChatTaskToolName,
  meta: ToolMeta,
  task: PublicTaskSummaryTask | null,
): string => {
  const phase = getToolLifecyclePhase(meta);
  if (tool === "search_tasks") return taskSearchSummary(meta);
  if (phase === "failed") return meta.error || "Tool failed";
  if (phase === "cancelled") return "Tool cancelled";
  if (task) return task.title;
  if (phase === "completed") return "Invalid task result";
  const title = CreateTaskInputSchema.shape.title.safeParse(meta.input?.title);
  if (title.success) return title.data;
  return tool === "update_task" ? "Updating task" : "Creating task";
};

/** A completed create or update call without a valid task shows an alert. */
export const showsInvalidTaskToolAlert = (
  tool: AgentChatTaskToolName,
  meta: ToolMeta,
  task: PublicTaskSummaryTask | null,
): boolean =>
  (tool === "create_task" || tool === "update_task") &&
  getToolLifecyclePhase(meta) === "completed" &&
  task === null;

export const INVALID_TASK_TOOL_RESULT_MESSAGE =
  "OpenDucktor returned an invalid task result. Expand the tool output to inspect the response.";
