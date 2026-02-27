import type { PlanSubtaskInput } from "./contracts";

export async function createSubtask(
  parentTaskId: string,
  subtask: PlanSubtaskInput,
  runBdJson: (args: string[]) => Promise<unknown>,
  invalidateTaskIndex: () => void,
): Promise<string> {
  const args = [
    "create",
    subtask.title,
    "--type",
    subtask.issueType ?? "task",
    "--priority",
    String(subtask.priority ?? 2),
    "--parent",
    parentTaskId,
  ];

  if (subtask.description && subtask.description.trim().length > 0) {
    args.push("--description", subtask.description.trim());
  }

  const payload = await runBdJson(args);
  if (!payload || typeof payload !== "object") {
    throw new Error("Failed to create subtask");
  }

  const id = (payload as { id?: unknown }).id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Failed to resolve created subtask id");
  }

  invalidateTaskIndex();
  return id;
}

export async function deleteTaskById(
  taskId: string,
  runBdJson: (args: string[]) => Promise<unknown>,
  invalidateTaskIndex: () => void,
  deleteSubtasks = false,
): Promise<void> {
  const args = ["delete", "--force", "--reason", "Deleted from OpenDucktor"];
  if (deleteSubtasks) {
    args.push("--cascade");
  }
  args.push("--", taskId);
  await runBdJson(args);
  invalidateTaskIndex();
}
