// The tasks of the Fieldnotes workspace. The views show the same task with the same data, so a
// task that the chat creates is the task that the MCP board lists.
import type { Priority, TaskKind } from "../replica/vocabulary";

export type Task = { title: string; kind: TaskKind; priority: Priority };

export const TASKS = {
  k3x9: { title: "Open search with a keyboard shortcut", kind: "feature", priority: 2 },
  b8t1: { title: "Show an error when sync fails offline", kind: "bug", priority: 1 },
  m2q7: { title: "Export a notebook as Markdown", kind: "feature", priority: 2 },
  h5w3: { title: "Let people search notes by title", kind: "feature", priority: 2 },
  p6d4: { title: "Explain what to do in an empty notebook", kind: "task", priority: 3 },
  r9c2: { title: "Restore focus after closing search", kind: "task", priority: 2 },
  t4n8: { title: "Keep search closed while typing in a note", kind: "bug", priority: 1 },
  w1j5: { title: "Pin notes to the top of a notebook", kind: "feature", priority: 1 },
  e3k8: { title: "Add a print style for notes", kind: "feature", priority: 3 },
  g2s6: { title: "Sync tags across devices", kind: "feature", priority: 1 },
  c7v2: { title: "Import notes from a Markdown folder", kind: "feature", priority: 2 },
  q7d1: { title: "Export a notebook as PDF", kind: "feature", priority: 2 },
  w5j3: { title: "Add Export to the notebook menu", kind: "feature", priority: 3 },
  h4t8: { title: "Keep tags when you move a note", kind: "bug", priority: 1 },
} as const satisfies Record<string, Task>;

/** The suffix of the id of a task, such as k3x9 for fieldnotes-k3x9. */
export type TaskKey = keyof typeof TASKS;
