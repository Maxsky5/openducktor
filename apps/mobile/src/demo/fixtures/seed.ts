import {
  type AgentSessionModelSelection,
  type RepoAction,
  repoConfigSchema,
  type RuntimeKind,
  type SourceIssue,
  type TaskRecordData,
  type WorkspaceRecord,
  type WorkspaceSession,
} from "@openducktor/contracts";
import { ACTION_OUTPUT, REPO_ACTIONS } from "@openducktor/product-scenes/sample/actions";
import { CHAT_TITLES } from "@openducktor/product-scenes/sample/chats";
import { TASKS, type TaskKey } from "@openducktor/product-scenes/sample/tasks";
import { taskId as storyTaskId, WORKSPACES } from "@openducktor/product-scenes/sample/workspace";
import { specPlanBuildWorkflow } from "@openducktor/workflows";
import { createDemoRepository, type DemoFile } from "../demo-repository";
import {
  planMarkdown,
  promptRun,
  qaMarkdown,
  roleRun,
  specMarkdown,
  type DemoRoleOutcomes,
} from "../demo-runs";
import type { DemoRunScript } from "../demo-script";
import type { DemoSession, DemoSessionEngine } from "../demo-sessions";
import { taskRecord } from "../demo-tasks";
import type { DemoTerminalAction, DemoTerminalLine, DemoTerminals } from "../demo-terminals";
import type { DemoDocument, DemoTask, DemoWorkspace, DemoWorld } from "../demo-world";
import { SEARCH_MOCK_PNG_BASE64 } from "./images";
import { designSystemFiles, fableApiFiles, fieldnotesFiles } from "./repository-files";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const workflow = specPlanBuildWorkflow;

const HOME = "/Users/sam";
const repoPathOf = (name: string) => `${HOME}/code/${name}`;
const worktreeRootOf = (name: string) => `${HOME}/.openducktor/worktrees/${name}`;

/** The scripted output of the actions that the story has no output for. */
const SETUP_OUTPUT: DemoTerminalLine[] = [
  [{ text: "bun install v1.3.0", tone: "dim" }],
  [],
  [{ text: "+ vite@7.1.4", tone: "green" }],
  [{ text: "+ typescript@5.9.2", tone: "green" }],
  [],
  [
    { text: "128 packages", tone: "bold" },
    { text: " installed [1.12s]", tone: "dim" },
  ],
];
const TEST_OUTPUT: DemoTerminalLine[] = [
  [{ text: "bun test v1.3.0", tone: "dim" }],
  [],
  [{ text: "src/search/open-search.test.ts:", tone: "bold" }],
  [{ text: "✓", tone: "green" }, { text: " opens search with Cmd+K" }],
  [{ text: "✓", tone: "green" }, { text: " keeps search closed while typing" }],
  [],
  [{ text: " 12 pass", tone: "green" }],
  [{ text: " 0 fail" }],
  [{ text: "Ran 12 tests across 4 files. [0.41s]", tone: "dim" }],
];

type ActionId = keyof typeof REPO_ACTIONS;

const OUTPUT_BY_ACTION = {
  setup: SETUP_OUTPUT,
  // The story output starts with the command lines, which the demo terminal prints itself.
  web: ACTION_OUTPUT.web.slice(1),
  api: ACTION_OUTPUT.api.slice(1),
  test: TEST_OUTPUT,
} satisfies Record<ActionId, DemoTerminalLine[]>;

const actionsConfig = () => {
  const items: RepoAction[] = [];
  const output = new Map<string, DemoTerminalAction>();
  // SAFETY: REPO_ACTIONS is a closed object literal, so its keys are exactly its action IDs.
  for (const id of Object.keys(REPO_ACTIONS) as ActionId[]) {
    const action: { name: string; icon: RepoAction["icon"]; lines: readonly string[] } =
      REPO_ACTIONS[id];
    const item: RepoAction = {
      id,
      icon: action.icon,
      name: action.name,
      command: action.lines.join("\n"),
      runOnWorktreeCreate: id === "setup",
      waitBeforeAgentStart: id === "setup",
    };
    items.push(item);
    output.set(id, {
      name: item.name,
      command: item.command,
      output: OUTPUT_BY_ACTION[id],
      keepsRunning: id === "web" || id === "api",
    });
  }
  return { actions: { items, defaultActionId: "web" }, output };
};

const MODELS = {
  vega: { runtimeKind: "opencode", providerId: "vega", modelId: "vega-2-pro", variant: "high" },
  lyra: { runtimeKind: "claude", providerId: "claude", modelId: "claude-lyra-3", variant: "high" },
  astra: { runtimeKind: "codex", providerId: "openai", modelId: "gpt-6-astra", variant: "medium" },
} satisfies Record<"vega" | "lyra" | "astra", AgentSessionModelSelection>;

const runtimeOf = (model: AgentSessionModelSelection): RuntimeKind =>
  model.runtimeKind ?? "opencode";

export type DemoSeedModules = {
  world: DemoWorld;
  engine: DemoSessionEngine;
  outcomes: DemoRoleOutcomes;
  terminals: DemoTerminals;
};

/**
 * Fills the demo with the Fieldnotes story: three workspaces with tasks in every workflow state,
 * chats and task sessions with history, pending requests, worktree changes, a terminal, and
 * GitHub issues to import. Times are relative to the time of entry.
 */
export const seedDemo = ({ world, engine, outcomes, terminals }: DemoSeedModules): void => {
  const now = world.clock.now();
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();
  let sessionNumber = 1;

  const addWorkspace = (
    name: (typeof WORKSPACES)[number]["name"],
    files: Map<string, DemoFile>,
    isActive: boolean,
  ): DemoWorkspace => {
    const tile = WORKSPACES.find((workspace) => workspace.name === name)?.tile ?? null;
    const repoPath = repoPathOf(name);
    const record: WorkspaceRecord = {
      workspaceId: name,
      workspaceName: name,
      abbreviation: tile,
      tileColor: null,
      repoPath,
      iconDataUrl: null,
      isActive,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: worktreeRootOf(name),
      effectiveWorktreeBasePath: worktreeRootOf(name),
    };
    const { actions, output } = actionsConfig();
    const defaultTargetBranch = { remote: "origin", branch: "main" };
    const workspace: DemoWorkspace = {
      record,
      repoConfig: repoConfigSchema.parse({
        workspaceId: name,
        workspaceName: name,
        abbreviation: tile,
        repoPath,
        defaultModel: MODELS.vega,
        defaultTargetBranch,
        actions,
      }),
      repository: createDemoRepository({ repoPath, targetBranch: "main", files }),
      tasks: new Map(),
      issues: [],
      actionOutput: output,
      worktreeRoot: worktreeRootOf(name),
      defaultTargetBranch,
    };
    world.workspaces.set(name, workspace);
    return workspace;
  };

  const addTask = (
    workspace: DemoWorkspace,
    id: string,
    fields: Pick<TaskRecordData, "title" | "issueType" | "status"> &
      Partial<Pick<TaskRecordData, "priority" | "labels" | "description">> & {
        documents?: ("spec" | "plan" | "qaReport")[];
        hoursAgo: number;
      },
  ): DemoTask => {
    const updatedAt = at(fields.hoursAgo * HOUR);
    const task: DemoTask = {
      record: taskRecord({
        id,
        title: fields.title,
        issueType: fields.issueType,
        status: fields.status,
        priority: fields.priority ?? 2,
        labels: fields.labels ?? [],
        description: fields.description ?? "",
        createdAt: at((fields.hoursAgo + 30) * HOUR),
        updatedAt,
      }),
      documents: {},
      freeArtifacts: [],
      worktree: null,
    };
    for (const code of fields.documents ?? []) {
      const document: DemoDocument = {
        markdown:
          code === "spec"
            ? specMarkdown(task)
            : code === "plan"
              ? planMarkdown(task)
              : qaMarkdown(task),
        updatedAt,
        revision: 1,
      };
      if (code === "qaReport") document.verdict = "approved";
      task.documents[code] = document;
      task.record.artifactSummary[code] =
        code === "qaReport"
          ? { present: true, verdict: "approved", updatedAt }
          : { present: true, updatedAt };
    }
    workspace.tasks.set(id, task);
    return task;
  };

  const story = (workspace: DemoWorkspace, key: TaskKey) => ({
    id: storyTaskId(key, workspace.record.workspaceId),
    title: TASKS[key].title,
    issueType: TASKS[key].kind,
    priority: TASKS[key].priority,
  });

  /** Plays a script without delays or events, so the session starts with its history. */
  const play = (
    session: DemoSession,
    prompt: string,
    script: DemoRunScript,
    endedMinutesAgo: number,
  ) => {
    engine.acceptUserMessage(session, [{ kind: "text", text: prompt }]);
    // A played run keeps its history, but not its role outcome: the sample state holds that.
    const { onComplete: _outcome, ...played } = script;
    engine.startRun(session, played);
    // The played messages get times in the minutes before their end.
    const messages = session.history;
    const end = now - endedMinutesAgo * MINUTE;
    messages.forEach((message, index) => {
      const time = end - (messages.length - 1 - index) * 2 * MINUTE;
      message.timestamp = new Date(time).toISOString();
      for (const part of message.parts) {
        if (part.kind === "tool") {
          part.startedAtMs = time - 4_000;
          part.endedAtMs = time - 2_000;
        }
      }
      if (message.role === "assistant" && message.forkPoint) message.durationMs = 38_000;
    });
    session.lastActivityAt = end;
  };

  const taskSession = (
    workspace: DemoWorkspace,
    task: DemoTask,
    role: string,
    model: AgentSessionModelSelection,
    endedMinutesAgo: number,
  ): DemoSession => {
    const checkout = workflow.usesWorktree(role)
      ? outcomesWithWorktree(workspace, task)
      : workspace.repository.checkout(workspace.record.repoPath);
    const session = engine.create({
      externalSessionId: `${runtimeOf(model)}-seed-${sessionNumber++}`,
      workspace,
      owner: { kind: "task", taskId: task.record.id, role },
      runtimeKind: runtimeOf(model),
      workingDirectory: checkout.workingDirectory,
      title: `${workflow.role(role).label}: ${task.record.title}`,
      model,
      startedAtMs: now - (endedMinutesAgo + 20) * MINUTE,
      quiet: true,
    });
    play(
      session,
      role === "build"
        ? "Implement this task from its plan, then complete the build."
        : `Run the ${workflow.role(role).label} step of this task.`,
      roleRun({ workspace, checkout, outcomes }, task, role, { pullRequest: false, round: 1 }),
      endedMinutesAgo,
    );
    return session;
  };

  const outcomesWithWorktree = (workspace: DemoWorkspace, task: DemoTask) => {
    if (!task.worktree) {
      const slug = task.record.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 32);
      task.worktree = {
        workingDirectory: `${workspace.worktreeRoot}/${task.record.id}`,
        branch: `odt/${task.record.id}-${slug}`,
      };
      workspace.repository.addWorktree(task.worktree);
    }
    return workspace.repository.checkout(task.worktree.workingDirectory);
  };

  const chat = (
    workspace: DemoWorkspace,
    input: {
      title: string;
      model: AgentSessionModelSelection;
      worktree?: { name: string; branch: string };
      archived?: boolean;
      hoursAgo: number;
    },
  ): DemoSession => {
    const runtimeKind = runtimeOf(input.model);
    let executionTarget: WorkspaceSession["executionTarget"] = {
      kind: "local_repo_root",
      workingDirectory: workspace.record.repoPath,
    };
    if (input.worktree) {
      const workingDirectory = `${workspace.worktreeRoot}/${input.worktree.name}`;
      workspace.repository.addWorktree({ workingDirectory, branch: input.worktree.branch });
      executionTarget = {
        kind: "local_worktree",
        workingDirectory,
        branchName: input.worktree.branch,
        worktreeState: "present",
      };
    }
    const externalSessionId = `${runtimeKind}-seed-${sessionNumber++}`;
    const createdAt = now - (input.hoursAgo + 1) * HOUR;
    const updatedAt = now - input.hoursAgo * HOUR;
    const record: WorkspaceSession = {
      id: `chat-${sessionNumber}`,
      runtimeKind,
      externalSessionId,
      executionTarget,
      roleSnapshot: null,
      selectedModel: { ...input.model, runtimeKind },
      generatedTitle: null,
      manualTitle: input.title,
      targetBranch: input.worktree ? { remote: "origin", branch: "main" } : null,
      createdAt,
      lastActivityAt: updatedAt,
      updatedAt,
      archivedAt: input.archived ? updatedAt : null,
    };
    return engine.create({
      externalSessionId,
      workspace,
      owner: { kind: "chat", record },
      runtimeKind,
      workingDirectory: executionTarget.workingDirectory,
      title: input.title,
      model: input.model,
      startedAtMs: createdAt,
      quiet: true,
    });
  };

  // Fieldnotes --------------------------------------------------------------------------------

  const fieldnotes = addWorkspace("fieldnotes", fieldnotesFiles(), true);

  const shortcut = addTask(fieldnotes, story(fieldnotes, "k3x9").id, {
    ...story(fieldnotes, "k3x9"),
    status: "human_review",
    labels: ["search", "keyboard"],
    description:
      "People want to open search without the mouse. Open the search dialog with **Cmd+K** on macOS and **Ctrl+K** elsewhere.\n\nDo not open it while the cursor is in a text field.",
    documents: ["spec", "plan", "qaReport"],
    hoursAgo: 1,
  });
  shortcut.freeArtifacts.push({
    code: "search-dialog-mock",
    name: "Search dialog mock",
    fileName: "search-dialog-mock.png",
    mediaType: "image/png",
    base64: SEARCH_MOCK_PNG_BASE64,
    updatedAt: at(26 * HOUR),
  });
  const offlineError = addTask(fieldnotes, story(fieldnotes, "b8t1").id, {
    ...story(fieldnotes, "b8t1"),
    status: "ai_review",
    labels: ["sync"],
    description:
      "When the device is offline, sync fails without a message. Show what happened and when the app retries.",
    documents: ["spec", "plan"],
    hoursAgo: 2,
  });
  const exportMarkdown = addTask(fieldnotes, story(fieldnotes, "m2q7").id, {
    ...story(fieldnotes, "m2q7"),
    status: "in_progress",
    labels: ["export"],
    description: "Export every note of a notebook as one Markdown file per note, in a zip file.",
    documents: ["spec", "plan"],
    hoursAgo: 0.2,
  });
  const emptyNotebook = addTask(fieldnotes, story(fieldnotes, "p6d4").id, {
    ...story(fieldnotes, "p6d4"),
    status: "in_progress",
    labels: ["onboarding"],
    description: "An empty notebook shows a blank page. Tell people what they can do first.",
    documents: ["spec", "plan"],
    hoursAgo: 0.1,
  });
  addTask(fieldnotes, story(fieldnotes, "h5w3").id, {
    ...story(fieldnotes, "h5w3"),
    status: "spec_ready",
    labels: ["search"],
    description: "Let people type part of a note title to find the note.",
    documents: ["spec"],
    hoursAgo: 5,
  });
  addTask(fieldnotes, story(fieldnotes, "r9c2").id, {
    ...story(fieldnotes, "r9c2"),
    status: "ready_for_dev",
    labels: ["search", "accessibility"],
    description: "After search closes, put the keyboard focus back on the control that opened it.",
    documents: ["spec", "plan"],
    hoursAgo: 8,
  });
  const blocked = addTask(fieldnotes, story(fieldnotes, "t4n8").id, {
    ...story(fieldnotes, "t4n8"),
    status: "blocked",
    labels: ["search", "editor"],
    description: "Typing Cmd+K in the note editor must insert a link, not open search.",
    documents: ["spec", "plan"],
    hoursAgo: 4,
  });
  outcomesWithWorktree(fieldnotes, blocked);
  addTask(fieldnotes, story(fieldnotes, "w1j5").id, {
    ...story(fieldnotes, "w1j5"),
    status: "open",
    labels: ["notebooks"],
    description: "Let people pin a note so it stays at the top of its notebook.",
    hoursAgo: 20,
  });
  addTask(fieldnotes, story(fieldnotes, "e3k8").id, {
    ...story(fieldnotes, "e3k8"),
    status: "open",
    labels: ["print"],
    hoursAgo: 30,
  });
  addTask(fieldnotes, story(fieldnotes, "g2s6").id, {
    ...story(fieldnotes, "g2s6"),
    status: "closed",
    labels: ["sync", "tags"],
    documents: ["spec", "plan", "qaReport"],
    hoursAgo: 26,
  });
  addTask(fieldnotes, story(fieldnotes, "n2r6").id, {
    ...story(fieldnotes, "n2r6"),
    status: "closed",
    labels: ["editor"],
    documents: ["spec", "plan", "qaReport"],
    hoursAgo: 50,
  });

  // The task sessions of the reviewed shortcut task, with commits on its branch.
  for (const [role, model, minutes] of [
    ["spec", MODELS.lyra, 200],
    ["planner", MODELS.astra, 170],
    ["build", MODELS.vega, 120],
    ["qa", MODELS.vega, 70],
  ] as const) {
    engine.goLive(taskSession(fieldnotes, shortcut, role, model, minutes));
  }
  engine.goLive(taskSession(fieldnotes, offlineError, "build", MODELS.lyra, 140));

  // The Builder of the export task waits for a permission answer, with an uncommitted change.
  const exportBuilder = taskSession(fieldnotes, exportMarkdown, "build", MODELS.vega, 30);
  const exportCheckout = outcomesWithWorktree(fieldnotes, exportMarkdown);
  exportCheckout.uncommitted.set("src/export/markdown.ts", {
    kind: "text",
    text: `import type { Note } from "../notes/notebook";

/** One Markdown file for each note. */
export function exportMarkdown(notes: readonly Note[]): Map<string, string> {
  return new Map(notes.map((note) => [\`\${note.id}.md\`, \`# \${note.title}\\n\`]));
}
`,
  });
  const exportPrompt = "Add a short note about the export format to the agent notes.";
  play(
    exportBuilder,
    exportPrompt,
    promptRun({ workspace: fieldnotes, checkout: exportCheckout, outcomes }, exportPrompt),
    2,
  );
  engine.goLive(exportBuilder);

  // The Builder of the empty notebook task asks a question.
  const questionBuilder = engine.create({
    externalSessionId: `claude-seed-${sessionNumber++}`,
    workspace: fieldnotes,
    owner: { kind: "task", taskId: emptyNotebook.record.id, role: "build" },
    runtimeKind: "claude",
    workingDirectory: outcomesWithWorktree(fieldnotes, emptyNotebook).workingDirectory,
    title: `Builder: ${emptyNotebook.record.title}`,
    model: MODELS.lyra,
    startedAtMs: now - 12 * MINUTE,
    quiet: true,
  });
  play(
    questionBuilder,
    "Implement this task from its plan, then complete the build.",
    {
      steps: [
        {
          kind: "reasoning",
          text: "The plan leaves the first action open. I will ask before I build the empty state.",
        },
        {
          kind: "tool",
          tool: "read",
          toolType: "read",
          title: "Read src/notes/notebook.ts",
          input: { file_path: `${questionBuilder.ref.workingDirectory}/src/notes/notebook.ts` },
          output: "export type Notebook = { id: string; name: string; notes: Note[] };",
        },
        {
          kind: "question",
          questions: [
            {
              header: "Empty state",
              question: "Which action should the empty notebook offer first?",
              options: [
                {
                  label: "Create a note",
                  description: "Start with a blank note in this notebook.",
                },
                { label: "Import notes", description: "Bring notes in from a Markdown folder." },
              ],
              custom: true,
            },
          ],
        },
        {
          kind: "text",
          text: "I will build the empty state with that action first, then run the tests.",
        },
      ],
    },
    3,
  );
  engine.goLive(questionBuilder);

  // A chat with a full history: thinking, tool calls with diffs, todos, and a subagent.
  const tagsChat = chat(fieldnotes, {
    title: CHAT_TITLES.tags,
    model: MODELS.lyra,
    worktree: { name: "tags-sync", branch: "odt/tags-sync-fix" },
    hoursAgo: 3,
  });
  const tagsCheckout = fieldnotes.repository.checkout(tagsChat.ref.workingDirectory);
  play(
    tagsChat,
    "Why do tags drop on sync? Fix it if you find the cause.",
    {
      steps: [
        {
          kind: "todos",
          todos: [
            {
              id: "1",
              content: "Find where sync copies tags",
              status: "completed",
              priority: "high",
            },
            { id: "2", content: "Fix the copy", status: "completed", priority: "high" },
            { id: "3", content: "Run the tests", status: "completed", priority: "medium" },
          ],
        },
        {
          kind: "reasoning",
          text: "Tags drop after a move between notebooks. The copy keeps the tag objects but not their note link.",
        },
        {
          kind: "tool",
          tool: "grep",
          toolType: "search",
          title: "Search copyTags",
          input: { pattern: "copyTags", path: "src" },
          output: "src/tags/tags.ts",
        },
        {
          kind: "tool",
          tool: "read",
          toolType: "read",
          title: "Read src/tags/tags.ts",
          input: { file_path: `${tagsCheckout.workingDirectory}/src/tags/tags.ts` },
          output: "export function copyTags(tags: readonly Tag[]): Tag[] {",
        },
        {
          kind: "tool",
          tool: "edit",
          toolType: "file_edit",
          title: "Edit src/tags/tags.ts",
          input: { file_path: `${tagsCheckout.workingDirectory}/src/tags/tags.ts` },
          output: "The file was updated.",
          edit: () =>
            fieldnotes.repository.commit(
              tagsCheckout,
              new Map([
                [
                  "src/tags/tags.ts",
                  {
                    kind: "text",
                    text: `export type Tag = { id: string; name: string; noteId: string };

/** Moves the tags of a note to its copy, linked to the copy. */
export function copyTags(tags: readonly Tag[], noteId: string): Tag[] {
  return tags.map((tag) => ({ ...tag, noteId }));
}
`,
                  },
                ],
              ]),
              "Keep tags when a note moves",
            ),
        },
        {
          kind: "tool",
          tool: "bash",
          toolType: "bash",
          title: "bun test",
          input: { command: "bun test src/tags" },
          output: "3 pass, 0 fail",
        },
        {
          kind: "text",
          text: "The sync copied tags without their note link, so the server dropped them. `copyTags` now links each copy to its note, and the tag tests pass.",
        },
      ],
    },
    180,
  );
  const tagsAnswer = tagsChat.history.at(-1);
  if (tagsAnswer?.role === "assistant") {
    tagsAnswer.parts.splice(2, 0, {
      kind: "subagent",
      messageId: tagsAnswer.messageId,
      partId: `${tagsAnswer.messageId}-subagent`,
      correlationKey: "call:reviewer-1",
      status: "completed",
      agent: "reviewer",
      description: "Check how sync sends tags",
      prompt: "Read src/sync and tell me which fields of a tag the sync sends.",
      startedAtMs: now - 186 * MINUTE,
      endedAtMs: now - 185 * MINUTE,
    });
  }
  engine.goLive(tagsChat);

  const releaseChat = chat(fieldnotes, {
    title: "Plan the 2.0 release notes",
    model: MODELS.vega,
    archived: true,
    hoursAgo: 40,
  });
  play(
    releaseChat,
    "What should the 2.0 release notes say?",
    promptRun(
      {
        workspace: fieldnotes,
        checkout: fieldnotes.repository.checkout(fieldnotes.record.repoPath),
        outcomes,
      },
      "What should the 2.0 release notes say?",
    ),
    40 * 60,
  );
  engine.goLive(releaseChat);

  const searchChat = chat(fieldnotes, {
    title: "How does search rank notes?",
    model: MODELS.astra,
    hoursAgo: 6,
  });
  play(
    searchChat,
    "How does search rank notes?",
    promptRun(
      {
        workspace: fieldnotes,
        checkout: fieldnotes.repository.checkout(fieldnotes.record.repoPath),
        outcomes,
      },
      "How does search rank notes?",
    ),
    6 * 60,
  );
  engine.goLive(searchChat);

  // One terminal of the shortcut task with earlier output.
  if (shortcut.worktree)
    terminals.seed({
      label: shortcut.worktree.workingDirectory,
      context: {
        workspaceId: fieldnotes.record.workspaceId,
        repoPath: fieldnotes.record.repoPath,
        taskId: shortcut.record.id,
      },
      workingDir: shortcut.worktree.workingDirectory,
      history: [
        "demo:fieldnotes$ bun test",
        "src/search: 12 pass, 0 fail",
        "Ran 12 tests across 4 files. [0.41s]",
      ],
      createdAt: at(50 * MINUTE),
    });

  fieldnotes.issues = issues(fieldnotes, now);

  // Fable API and design system -----------------------------------------------------------------

  const fable = addWorkspace("fable-api", fableApiFiles(), false);
  addTask(fable, storyTaskId("a1c4", "fable-api"), {
    title: "Return 429 when a client sends too many requests",
    issueType: "feature",
    status: "spec_ready",
    priority: 1,
    labels: ["api"],
    documents: ["spec"],
    hoursAgo: 9,
  });
  addTask(fable, storyTaskId("d7f2", "fable-api"), {
    title: "Fix the chapter count of empty stories",
    issueType: "bug",
    status: "open",
    priority: 2,
    labels: ["stories"],
    hoursAgo: 15,
  });
  addTask(fable, storyTaskId("k8m1", "fable-api"), {
    title: "Document the health endpoint",
    issueType: "task",
    status: "closed",
    priority: 4,
    documents: ["spec", "plan", "qaReport"],
    hoursAgo: 30,
  });
  const fableChat = chat(fable, {
    title: "Which routes need auth?",
    model: MODELS.vega,
    hoursAgo: 10,
  });
  play(
    fableChat,
    "Which routes need auth?",
    promptRun(
      { workspace: fable, checkout: fable.repository.checkout(fable.record.repoPath), outcomes },
      "Which routes need auth?",
    ),
    10 * 60,
  );
  engine.goLive(fableChat);

  const design = addWorkspace("design-system", designSystemFiles(), false);
  addTask(design, storyTaskId("b2v9", "design-system"), {
    title: "Add a quiet button variant",
    issueType: "feature",
    status: "ready_for_dev",
    priority: 3,
    labels: ["button"],
    documents: ["spec", "plan"],
    hoursAgo: 12,
  });
  addTask(design, storyTaskId("c5q3", "design-system"), {
    title: "Darken the focus ring in dark mode",
    issueType: "bug",
    status: "open",
    priority: 2,
    labels: ["tokens"],
    hoursAgo: 18,
  });
};

/** The fictional GitHub issues of the Fieldnotes repository. */
const issues = (workspace: DemoWorkspace, now: number): SourceIssue[] => {
  const repository = "fieldnotes-demo/fieldnotes";
  const issue = (
    number: number,
    title: string,
    description: string,
    tags: string[],
    daysAgo: number,
  ): SourceIssue => ({
    providerId: "github",
    scope: repository,
    sourceId: `${repository}#${number}`,
    number: String(number),
    url: `https://github.com/${repository}/issues/${number}`,
    title,
    description,
    creator: "maya-fieldnotes",
    updatedAt: new Date(now - daysAgo * 86_400_000).toISOString(),
    tags,
    revision: `r${number}`,
  });
  void workspace;
  return [
    issue(
      41,
      "Dark mode for the note editor",
      "The editor stays light when the system uses dark mode.",
      ["enhancement"],
      1,
    ),
    issue(
      44,
      "Duplicate a notebook",
      "Copy a notebook with all its notes and tags.",
      ["enhancement"],
      3,
    ),
    issue(
      47,
      "Search ignores accents",
      "Searching for cafe does not find café.",
      ["bug", "search"],
      4,
    ),
    issue(
      52,
      "Show the last sync time",
      "Show when the app last saved to the server.",
      ["sync"],
      6,
    ),
  ];
};
