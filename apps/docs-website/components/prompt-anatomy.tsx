import type { ReactNode } from "react";

const TASK_ID = "fieldnotes-x3m8q";

/** Text that OpenDucktor put in place of a placeholder. Pointing to it shows the placeholder. */
function Fill({ name, children }: { name: string; children: ReactNode }) {
  return (
    <mark className="docs-anatomy-fill" title={`{{${name}}}`}>
      {children}
    </mark>
  );
}

const PARTS: { name: string; source: string; body: ReactNode }[] = [
  {
    name: "Builder Instructions",
    source: "The role of the session",
    body: (
      <>
        You are the Build Agent for OpenDucktor. Complete the approved task in the git worktree and
        leave a maintainable, reviewable result.{"\n\n"}Implementation:{"\n"}- Read the task,
        available spec and plan, relevant code, and repo guidance before editing.{"\n"}…
      </>
    ),
  },
  {
    name: "Workflow Guards",
    source: "Same for all roles",
    body: (
      <>
        Workflow constraints you must obey:{"\n\n"}Lifecycle contract:{"\n"}- Feature flow: open
        -&gt; spec_ready -&gt; ready_for_dev -&gt; in_progress -&gt; ai_review/human_review -&gt;
        closed.{"\n"}…
      </>
    ),
  },
  {
    name: "Tool Protocol",
    source: "Same for all roles, with the tools of the role",
    body: (
      <>
        OpenDucktor workflow tools are native MCP tools.{"\n"}…{"\n\n"}Allowed OpenDucktor workflow
        tools for this role:{"\n"}
        <Fill name="role.allowedTools">
          {'- odt_read_task({"taskId": string})'}
          {"\n"}…{"\n"}
          {'- odt_apply_workflow_event({"taskId": string, "eventId": string, "note"?: string})'}
          {"\n"}…
        </Fill>
        {"\n\n"}Session task lock:{"\n"}- Use this exact taskId literal in every task-bound odt_*
        call: <Fill name="task.id">{TASK_ID}</Fill>.{"\n"}…
      </>
    ),
  },
  {
    name: "Task Context",
    source: "The fields of the task",
    body: (
      <>
        Task context:{"\n"}- id: <Fill name="task.id">{TASK_ID}</Fill>
        {"\n"}- title: <Fill name="task.title">Add dark mode</Fill>
        {"\n"}- issueType: <Fill name="task.issueType">task</Fill>
        {"\n"}- currentStatus: <Fill name="task.status">in_progress</Fill>
        {"\n"}- description:{" "}
        <Fill name="task.description">Add a dark theme that follows the system setting.</Fill>
        {"\n\n"}Artifact access:{"\n"}…
      </>
    ),
  },
];

/**
 * The system prompt that a Builder session gets, shortened. Each part shows its prompt, and the
 * marked text shows the values of the placeholders.
 */
export function PromptAnatomy() {
  return (
    <figure className="docs-anatomy not-prose">
      <figcaption>
        <span>
          System prompt of a Builder session on the task <strong>Add dark mode</strong>, shortened
        </span>
        <span className="docs-anatomy-legend">
          <mark className="docs-anatomy-fill">value</mark> Placeholder value
        </span>
      </figcaption>
      <ol>
        {PARTS.map((part, index) => (
          <li key={part.name} data-part={index + 1}>
            <p className="docs-anatomy-label">
              <span className="docs-anatomy-number">{index + 1}</span>
              <strong>{part.name}</strong>
              <small>{part.source}</small>
            </p>
            <pre>{part.body}</pre>
          </li>
        ))}
      </ol>
    </figure>
  );
}
