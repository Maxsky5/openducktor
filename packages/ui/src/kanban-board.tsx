import type { TaskCard, TaskPhase } from "@openblueprint/contracts";
import { type KanbanColumn, mapToKanbanColumns } from "@openblueprint/core";
import type { CSSProperties, ChangeEvent, ReactElement, ReactNode } from "react";

type Props = {
  tasks: TaskCard[];
  onMoveTask: (taskId: string, phase: TaskPhase) => void;
  onSelectTask: (taskId: string) => void;
};

const cardStyle: CSSProperties = {
  background: "#0f172a",
  color: "#f8fafc",
  borderRadius: 8,
  padding: 10,
  marginBottom: 8,
  border: "1px solid #1e293b",
  cursor: "pointer",
};

const phaseOptions: Array<{ label: string; value: TaskPhase }> = [
  { label: "Backlog", value: "backlog" },
  { label: "Specifying", value: "specifying" },
  { label: "Ready", value: "ready_for_dev" },
  { label: "In Progress", value: "in_progress" },
  { label: "Blocked", value: "blocked_needs_input" },
  { label: "Done", value: "done" },
];

const renderColumn = (
  column: KanbanColumn,
  onMoveTask: (taskId: string, phase: TaskPhase) => void,
  onSelectTask: (taskId: string) => void,
): ReactNode => {
  return (
    <section
      key={column.id}
      style={{
        minWidth: 240,
        background: "#f8fafc",
        borderRadius: 10,
        padding: 12,
        border: "1px solid #e2e8f0",
      }}
    >
      <h3 style={{ marginTop: 0 }}>{column.title}</h3>
      {column.tasks.map((task) => (
        <article key={task.id} style={cardStyle}>
          <strong>{task.title}</strong>
          <p style={{ margin: "8px 0", fontSize: 12, opacity: 0.9 }}>{task.id}</p>
          <button type="button" onClick={() => onSelectTask(task.id)} style={{ width: "100%" }}>
            Open Task
          </button>
          <label style={{ display: "block", fontSize: 12 }}>
            Phase
            <select
              value={task.phase ?? "backlog"}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                onMoveTask(task.id, event.currentTarget.value as TaskPhase)
              }
              style={{ width: "100%", marginTop: 4 }}
            >
              {phaseOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </article>
      ))}
    </section>
  );
};

export function KanbanBoard({ tasks, onMoveTask, onSelectTask }: Props): ReactElement {
  const columns = mapToKanbanColumns(tasks);

  return (
    <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 12 }}>
      {columns.map((column) => renderColumn(column, onMoveTask, onSelectTask))}
    </div>
  );
}
