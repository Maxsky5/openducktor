import type { DemoDocumentCode, DemoTask, DemoWorkspace } from "./demo-world";
import type { DemoCheckout, DemoFile, DemoRepository } from "./demo-repository";
import { asksForChange, type DemoRunScript, type DemoRunStep, firstLine } from "./demo-script";

/** How a document save ends: its review verdict, and whether it applies its submit event. */
export type DemoDocumentSaveOptions = { verdict?: "approved" | "rejected"; submit: boolean };

/** The task commands that a role run uses for its outcome. */
export type DemoRoleOutcomes = {
  saveDocument(
    workspace: DemoWorkspace,
    taskId: string,
    code: DemoDocumentCode,
    markdown: string,
    options: DemoDocumentSaveOptions,
  ): void;
  applyEvent(workspace: DemoWorkspace, taskId: string, eventId: string): void;
  linkPullRequest(workspace: DemoWorkspace, taskId: string, title: string, body: string): void;
};

const text = (value: string): DemoFile => ({ kind: "text", text: value });

const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "change";

const camelOf = (title: string): string => {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .trim()
    .split(/\s+/)
    .slice(0, 5);
  return (
    words
      .map((word, index) =>
        index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`,
      )
      .join("") || "change"
  );
};

/** The Specification of a task, as the Spec run writes it. */
export const specMarkdown = (task: DemoTask): string => `# ${task.record.title}

## Problem

Fieldnotes users ask for this change in their feedback. Today the app has no direct way to do it, so people work around it by hand.

## Requirements

- The change works the same way on the web and on desktop.
- The existing notes, notebooks, and tags stay unchanged.
- Keyboard and screen reader users can reach the new behavior.

## Acceptance criteria

1. The new behavior works in a notebook with 1,000 notes without a visible delay.
2. Unit tests cover the main path and the empty state.
3. The changelog names the change.
`;

/** The Implementation Plan of a task, as the Planner run writes it. */
export const planMarkdown = (task: DemoTask): string => `# Plan: ${task.record.title}

## Steps

1. Add \`src/features/${slugOf(task.record.title)}.ts\` with the core logic.
2. Add unit tests next to it.
3. Name the change in \`CHANGELOG.md\`.

## Risks

- Large notebooks: keep the work linear in the number of notes.
`;

/** The QA Report of a task, as the QA run writes it. The demo QA always approves. */
export const qaMarkdown = (task: DemoTask): string => `# QA Report: ${task.record.title}

## Verdict

Approved.

## Checks

- Unit tests pass: 12 of 12.
- The changed files match the Implementation Plan.
- No open review comments.
`;

/** The files that a Builder run writes for a task. */
const buildChanges = (task: DemoTask, round: number): Map<string, DemoFile> => {
  const slug = slugOf(task.record.title);
  const name = camelOf(task.record.title);
  return new Map([
    [
      `src/features/${slug}.ts`,
      text(`import type { Note } from "../notes/notebook";

/** ${task.record.title}. */
export function ${name}(notes: readonly Note[]): Note[] {
  return notes.filter((note) => !note.archived)${round > 1 ? "\n    .sort((left, right) => right.updatedAt - left.updatedAt)" : ""};
}
`),
    ],
    [
      `src/features/${slug}.test.ts`,
      text(`import { expect, test } from "bun:test";
import { ${name} } from "./${slug}";

test("${task.record.title.replace(/"/g, "'")}", () => {
  expect(${name}([])).toEqual([]);
});
`),
    ],
  ]);
};

/** The placeholder file of the empty features folder of the Fieldnotes repository. */
const FEATURES_PLACEHOLDER = "src/features/placeholder.ts";

const changelogWith = (
  repository: DemoRepository,
  checkout: DemoCheckout,
  line: string,
): DemoFile => {
  const current = repository.readFile(checkout, "CHANGELOG.md");
  const body = current?.kind === "text" ? current.text : "# Changelog\n";
  return text(body.replace(/^(# Changelog\n\n?)/, `$1- ${line}\n`));
};

const testOutput = `bun test v1.3.0

src/features: 12 pass, 0 fail
Ran 12 tests across 4 files. [0.41s]`;

export type DemoRunContext = {
  workspace: DemoWorkspace;
  checkout: DemoCheckout;
  outcomes: DemoRoleOutcomes;
};

/** The scripted answer to a prompt. A prompt that asks for a change edits one file after approval. */
export const promptRun = (context: DemoRunContext, prompt: string): DemoRunScript => {
  const { workspace, checkout } = context;
  const { repository } = workspace;
  const line = firstLine(prompt) || "your message";
  const canEdit = checkout.workingDirectory !== repository.repoPath && asksForChange(prompt);
  const steps: DemoRunStep[] = [
    { kind: "reasoning", text: `The request is "${line}". I will read the notebook code first.` },
    {
      kind: "tool",
      tool: "grep",
      toolType: "search",
      title: "Search notebook code",
      input: { pattern: "notebook", path: "src" },
      output: "src/notes/notebook.ts\nsrc/app.tsx",
    },
    {
      kind: "tool",
      tool: "read",
      toolType: "read",
      title: "Read src/notes/notebook.ts",
      input: { file_path: `${checkout.workingDirectory}/src/notes/notebook.ts` },
      output:
        "export type Note = { id: string; title: string; archived: boolean; updatedAt: number };",
    },
  ];
  if (!canEdit) {
    steps.push({
      kind: "text",
      text: `About "${line}": the notebook code keeps notes in \`src/notes/notebook.ts\`, and the app shell in \`src/app.tsx\` renders them. No file needs a change to answer this.`,
    });
    return { steps };
  }
  const path = "docs/agent-notes.md";
  steps.push(
    { kind: "permission", title: `Edit ${path}`, paths: [path] },
    {
      kind: "tool",
      tool: "edit",
      toolType: "file_edit",
      title: `Edit ${path}`,
      input: { file_path: `${checkout.workingDirectory}/${path}` },
      output: "The file was updated.",
      needsApproval: true,
      edit: () => {
        const current = repository.readFile(checkout, path);
        const body = current?.kind === "text" ? current.text : "# Agent notes\n\n";
        return repository.commit(checkout, new Map([[path, text(`${body}- ${line}\n`)]]), line);
      },
    },
    {
      kind: "tool",
      tool: "bash",
      toolType: "bash",
      title: "bun test",
      input: { command: "bun test" },
      output: testOutput,
      needsApproval: true,
    },
    {
      kind: "text",
      text: `Done: "${line}". I updated \`${path}\`, committed it, and ran the tests. All 12 tests pass.`,
    },
  );
  return {
    steps,
    rejectedText: `I did not change any files for "${line}", because you rejected the edit. Tell me what to change, and I will try again.`,
  };
};

const readTask = (task: DemoTask): DemoRunStep => ({
  kind: "tool",
  tool: "odt_read_task",
  toolType: "workflow",
  title: "Read task",
  input: { taskId: task.record.id },
  output: `${task.record.title} (${task.record.status})`,
});

const workflowTool = (tool: string, title: string, input: Record<string, string>): DemoRunStep => ({
  kind: "tool",
  tool,
  toolType: "workflow",
  title,
  input,
  output: "Saved.",
});

/** The scripted run of a workflow role. Its outcome applies when the run ends. */
export const roleRun = (
  context: DemoRunContext,
  task: DemoTask,
  role: string,
  options: { pullRequest: boolean; round: number },
): DemoRunScript => {
  const { workspace, checkout, outcomes } = context;
  const { repository } = workspace;
  const taskId = task.record.id;
  if (options.pullRequest) {
    const title = task.record.title;
    const summary = task.record.description?.split("\n\n")[0]?.trim() || title;
    const body = [
      "## Summary",
      summary,
      "## Changes",
      repository
        .branchDiffs(checkout)
        .map((diff) => `- ${diff.type} \`${diff.file}\``)
        .join("\n"),
      "## Tests",
      "- `bun test`: 12 pass, 0 fail",
    ].join("\n\n");
    return {
      steps: [
        {
          kind: "reasoning",
          text: "I will write a pull request title and description from the task and its commits.",
        },
        {
          kind: "tool",
          tool: "bash",
          toolType: "bash",
          title: "git log --oneline",
          input: { command: "git log --oneline origin/main..HEAD" },
          output: `${checkout.revision.slice(0, 7)} ${title}`,
        },
        workflowTool("odt_set_pull_request", "Open pull request", { title, body }),
        {
          kind: "text",
          text: `I opened the pull request "${title}" with this description. Its checks pass.\n\n${body}`,
        },
      ],
      onComplete: () => outcomes.linkPullRequest(workspace, taskId, title, body),
    };
  }
  switch (role) {
    case "spec":
      return {
        steps: [
          readTask(task),
          {
            kind: "reasoning",
            text: "I will check how the notebook works today, then write the specification.",
          },
          {
            kind: "tool",
            tool: "grep",
            toolType: "search",
            title: "Search src",
            input: { pattern: "notebook", path: "src" },
            output: "src/notes/notebook.ts",
          },
          workflowTool("odt_set_spec", "Save Specification", { taskId }),
          { kind: "text", text: "I saved the Specification. The task is ready for planning." },
        ],
        onComplete: () =>
          outcomes.saveDocument(workspace, taskId, "spec", specMarkdown(task), { submit: true }),
      };
    case "planner":
      return {
        steps: [
          readTask(task),
          {
            kind: "reasoning",
            text: "The specification asks for a small change. I will plan three steps.",
          },
          {
            kind: "tool",
            tool: "read",
            toolType: "read",
            title: "Read src/app.tsx",
            input: { file_path: `${checkout.workingDirectory}/src/app.tsx` },
            output: "export function App() { … }",
          },
          workflowTool("odt_set_plan", "Save Implementation Plan", { taskId }),
          {
            kind: "text",
            text: "I saved the Implementation Plan. The task is ready for development.",
          },
        ],
        onComplete: () =>
          outcomes.saveDocument(workspace, taskId, "plan", planMarkdown(task), { submit: true }),
      };
    case "qa":
      return {
        steps: [
          readTask(task),
          {
            kind: "tool",
            tool: "bash",
            toolType: "bash",
            title: "git diff --stat",
            input: { command: "git diff --stat origin/main" },
            output: `${repository.branchDiffs(checkout).length} files changed`,
          },
          {
            kind: "tool",
            tool: "bash",
            toolType: "bash",
            title: "bun test",
            input: { command: "bun test" },
            output: testOutput,
          },
          workflowTool("odt_set_qa_report", "Save QA Report", { taskId, verdict: "approved" }),
          {
            kind: "text",
            text: "The change meets the specification and the tests pass. I approved it.",
          },
        ],
        onComplete: () =>
          outcomes.saveDocument(workspace, taskId, "qaReport", qaMarkdown(task), {
            verdict: "approved",
            submit: true,
          }),
      };
    default: {
      const changes = buildChanges(task, options.round);
      const paths = [...changes.keys()];
      return {
        steps: [
          {
            kind: "todos",
            todos: [
              { id: "1", content: "Read the plan", status: "completed", priority: "high" },
              {
                id: "2",
                content: "Write the feature and its tests",
                status: "in_progress",
                priority: "high",
              },
              { id: "3", content: "Run the tests", status: "pending", priority: "medium" },
            ],
          },
          readTask(task),
          {
            kind: "tool",
            tool: "write",
            toolType: "file_edit",
            title: `Write ${paths[0] ?? "files"}`,
            input: { file_path: `${checkout.workingDirectory}/${paths[0] ?? ""}` },
            output: "The files were written.",
            edit: () => {
              const commit = new Map<string, DemoFile | null>([
                ...changes,
                ["CHANGELOG.md", changelogWith(repository, checkout, task.record.title)],
              ]);
              // The first feature replaces the placeholder of the features folder.
              if (repository.readFile(checkout, FEATURES_PLACEHOLDER))
                commit.set(FEATURES_PLACEHOLDER, null);
              return repository.commit(checkout, commit, task.record.title);
            },
          },
          {
            kind: "tool",
            tool: "bash",
            toolType: "bash",
            title: "bun test",
            input: { command: "bun test" },
            output: testOutput,
          },
          {
            kind: "todos",
            todos: [
              { id: "1", content: "Read the plan", status: "completed", priority: "high" },
              {
                id: "2",
                content: "Write the feature and its tests",
                status: "completed",
                priority: "high",
              },
              { id: "3", content: "Run the tests", status: "completed", priority: "medium" },
            ],
          },
          workflowTool("odt_build_completed", "Complete build", { taskId }),
          {
            kind: "text",
            text: `I built "${task.record.title}", committed the change, and the tests pass. The task is ready for review.`,
          },
        ],
        onComplete: () => outcomes.applyEvent(workspace, taskId, "build-completed"),
      };
    }
  }
};

/**
 * The first message of a role run. The client sends the kickoff prompt that it built, and the demo
 * shows it as the host does. Without one, the demo writes a short kickoff of the role.
 */
export const kickoffText = (
  role: string,
  pullRequest: boolean,
  { text, feedback }: { text?: string | undefined; feedback?: string | undefined },
): string => {
  if (text?.trim()) return feedback ? `${text}\n\n${feedback}` : text;
  if (pullRequest)
    return "Write the pull request title and description, then open the pull request.";
  switch (role) {
    case "spec":
      return "Write the specification of this task.";
    case "planner":
      return "Write the implementation plan of this task.";
    case "qa":
      return "Review the implementation of this task and save a QA report.";
    default:
      return feedback
        ? `Apply the requested changes.\n\n${feedback}`
        : "Implement this task from its plan, then complete the build.";
  }
};
