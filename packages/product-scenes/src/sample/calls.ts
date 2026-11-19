// The tool calls of the sample transcripts, as the app names them on each runtime. A shell
// command shows as `bash` and a file edit as `edit`. Codex runs its reads and its searches as
// shell commands, so they show as `bash` with the icon of their action.
import type { Call, Row, ToolType } from "../replicas/transcript/model";

/** A call row of a transcript. */
export type CallRow = Extract<Row, { kind: "call" }>;

/** A call with the row id `id`. */
export function call<Id extends string>(id: Id, data: Call): CallRow & { id: Id } {
  return { kind: "call", id, ...data };
}

/** A shell command. A read or a search of Codex keeps the icon of its action. */
export function bash<Id extends string>(
  id: Id,
  command: string,
  duration: string,
  time: string,
  tool: Extract<ToolType, "bash" | "read" | "search"> = "bash",
): CallRow & { id: Id } {
  return call(id, { tool, name: "bash", command, duration, time });
}

/** A file that Codex reads with a shell command. */
export function catFile<Id extends string>(
  id: Id,
  path: string,
  duration: string,
  time: string,
): CallRow & { id: Id } {
  return bash(id, `cat ${path}`, duration, time, "read");
}

/** A file edit, such as an apply_patch call of Codex, that changes one file. */
export function edit<Id extends string>(
  id: Id,
  path: string,
  lines: { add: number; del: number },
  duration: string,
  time: string,
): CallRow & { id: Id } {
  return call(id, {
    tool: "file_edit",
    name: "edit",
    summary: path,
    file: true,
    ...lines,
    duration,
    time,
  });
}

/** odt_read_task of the task `task`. */
export function readTask(
  task: string,
  duration: string,
  time: string,
): CallRow & { id: "read-task" } {
  return call("read-task", { tool: "tool", name: "read_task", summary: task, duration, time });
}
