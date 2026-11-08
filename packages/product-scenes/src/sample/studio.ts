// Shared values of the session window replica. The model names are fictional.
import type { ArtifactLabels, GitFile, StudioFrame } from "../replicas/studio/model";
import type { Session } from "./sessions";
import { settled, studioNav } from "./studio-nav";
import { taskId } from "./workspace";

/** Every session of the task uses the same Codex model, with a window of 400K tokens. */
const ASTRA = {
  runtime: "codex",
  model: "gpt-6-astra",
  window: 400_000,
  speed: "standard",
} as const;

export const SPEC_SESSION = { ...ASTRA, effort: "high", used: 9.4 } satisfies Session;
export const PLANNER_SESSION = { ...ASTRA, effort: "high", used: 14.2 } satisfies Session;
export const BUILDER_SESSION = { ...ASTRA, effort: "medium", used: 28 } satisfies Session;
/** The Builder session after the QA fix turn: the same session with more context. */
export const BUILDER_FIX_SESSION = { ...BUILDER_SESSION, used: 36.5 } satisfies Session;
/** The Builder session after the review fix turn. */
export const BUILDER_REVIEW_SESSION = { ...BUILDER_SESSION, used: 41.8 } satisfies Session;
/** The Builder session after the review turn and the pull request turn. */
export const BUILDER_PR_SESSION = { ...BUILDER_SESSION, used: 47.3 } satisfies Session;
export const QA_SESSION = { ...ASTRA, effort: "high", used: 17.9 } satisfies Session;

/** The workflow artifacts of the Artifacts tab, with the labels of the built-in workflow. */
export const ARTIFACTS = {
  spec: {
    title: "Specification",
    empty: "Specification has not been created yet.",
    editable: true,
  },
  plan: {
    title: "Implementation Plan",
    empty: "Implementation Plan has not been created yet.",
    editable: true,
  },
  qa: {
    title: "QA Report",
    empty: "QA Report has not been created yet.",
    editable: false,
    verdict: "Rejected",
  },
} satisfies Record<string, ArtifactLabels>;

/** Line 10 of the hook, where the review comment goes. */
const MODIFIER_CHECK = "      if (!modifier || event.shiftKey) return;";

/** The hook as the Builder first writes it. */
export const HOOK_LINES = [
  'import { useEffect } from "react";',
  "",
  'const isMac = navigator.platform.startsWith("Mac");',
  'const textFields = "input, textarea, [contenteditable]";',
  "",
  "export function useSearchShortcut(openSearch: () => void): void {",
  "  useEffect(() => {",
  "    const onKeyDown = (event: KeyboardEvent): void => {",
  "      const modifier = isMac ? event.metaKey : event.ctrlKey;",
  MODIFIER_CHECK,
  '      if (event.key.toLowerCase() !== "k") return;',
  "      const target = event.target as Element;",
  "      if (target.closest(textFields)) return;",
  "      event.preventDefault();",
  "      openSearch();",
  "    };",
  '    window.addEventListener("keydown", onKeyDown);',
  '    return () => window.removeEventListener("keydown", onKeyDown);',
  "  }, [openSearch]);",
  "}",
];

/** The QA fix: the shortcut does nothing while a modal dialog is open. */
const DIALOG_CHECK = "      if (document.querySelector('[aria-modal=\"true\"]')) return;";
export const FIXED_HOOK_LINES = [...HOOK_LINES.slice(0, 13), DIALOG_CHECK, ...HOOK_LINES.slice(13)];

/** The review fix on line 10: the shortcut leaves a Cmd+K that another handler took. */
const HANDLED_CHECK = "      if (!modifier || event.shiftKey || event.defaultPrevented) return;";

export const HOOK_PATH = "src/search/use-search-shortcut.ts";
export const TEST_PATH = "src/search/use-search-shortcut.test.ts";

function hookFile(add: number): GitFile {
  return { path: HOOK_PATH, type: "added", add, del: 0 };
}
function testFile(add: number): GitFile {
  return { path: TEST_PATH, type: "added", add, del: 0 };
}
const SHELL_FILE = {
  path: "src/app/app-shell.tsx",
  type: "modified",
  add: 3,
  del: 0,
} satisfies GitFile;
const DIALOG_FILE = {
  path: "src/search/search-dialog.tsx",
  type: "modified",
  add: 9,
  del: 2,
} satisfies GitFile;

/** The hook after the review fix: line 10 also checks event.defaultPrevented. */
export const REVIEWED_HOOK_LINES = FIXED_HOOK_LINES.map((line, index) =>
  index === 9 ? HANDLED_CHECK : line,
);

/** The files of the Builder change, in the order the Builder writes them. */
export const BUILD_FILES = [hookFile(HOOK_LINES.length), SHELL_FILE, DIALOG_FILE, testFile(64)];

/** The same files after the QA fix: one more line in the hook and one more test. */
export const FIXED_FILES = [
  hookFile(FIXED_HOOK_LINES.length),
  SHELL_FILE,
  DIALOG_FILE,
  testFile(76),
];

/** The files after the review fix: line 10 changes and one more test. */
export const REVIEWED_FILES = [
  hookFile(REVIEWED_HOOK_LINES.length),
  SHELL_FILE,
  DIALOG_FILE,
  testFile(87),
];

/** The file of a change at `path`. */
export function fileOf(files: readonly GitFile[], path: string): GitFile {
  const file = files.find((item) => item.path === path);
  if (!file) throw new Error(`The sample change has no file ${path}.`);
  return file;
}

export const TASK_ID = taskId("k3x9");

/** Kickoff prompt samples from packages/workflows/src/builtin/spec-plan-build/prompt-templates.ts. */
export const KICKOFF = {
  spec: `Write the specification for this task and save it with odt_set_task_artifact and code spec. Use taskId ${TASK_ID} for every task-bound odt_* tool call.`,
  planner: `Write the implementation plan for this task and save it with odt_set_task_artifact and code plan. Use taskId ${TASK_ID} for every task-bound odt_* tool call.`,
  build: `Implement this task and submit the completed change with odt_apply_workflow_event with eventId build-completed. Use taskId ${TASK_ID} for every task-bound odt_* tool call.`,
  qa: `Review this task's implementation and submit one QA report with exactly one odt_set_task_artifact call using code qaReport and verdict approved or rejected. Use taskId ${TASK_ID} for every task-bound odt_* tool call.`,
  fix: `Address the latest QA rejection for this task. Check each finding against the current code. Fix valid in-scope issues and explain why you decline any other finding. Submit the completed change with odt_apply_workflow_event with eventId build-completed. Use taskId ${TASK_ID} for every task-bound odt_* tool call.`,
  pullRequest: [
    "Publish a review-ready pull request for the current task.",
    "Pull request base:\norigin/main",
    [
      "Prepare:",
      "- Use the base branch for Git diffs, rebases, and pull request provider tools.",
      "- Treat the current task artifacts and live repository state as the source of truth.",
      "- Read the repository's contribution guidance and pull request template when present.",
      "- Inspect the source branch, any existing pull request, and the diff against the base branch.",
      "- If the source branch is behind the base branch, rebase it and resolve conflicts.",
      "- Complete repo-required local checks and choose any additional verification based on the diff and risk. Fix failures at the source and rerun affected checks; repeat passing checks only when changes or unresolved risks justify it.",
      "- Preparation is complete when the diff matches the current task and every required local check passes.",
    ].join("\n"),
    [
      "Publish:",
      "- Use a concise Conventional Commit-style pull request title that explains why the change matters.",
      "- Start the body with the problem and goal. Add reviewer context and decisions or tradeoffs that affect review.",
      "- For a new pull request, use the repository's template and fill each relevant section. Keep the body focused on the current task.",
      "- For an existing pull request, read its title and body. Preserve useful context, links, media, and edits from other authors. Update only what the current task makes inaccurate or what the user requests, and add missing task-specific context or UI evidence when relevant.",
      "- Push the source branch, create or update the pull request against the base branch, and confirm the published title and body follow repository conventions.",
    ].join("\n"),
    [
      "Complete:",
      `- After the pull request exists, call odt_set_pull_request with taskId ${TASK_ID} and the pull request number.`,
      "- Wait for required pull request checks to finish. If any fail, diagnose and fix the root cause, rerun the affected local checks, commit and push the fix, then check again until all required checks pass.",
      "- Completion criterion: the task references the pull request and every required pull request check passes.",
      "- Report the pull request URL and the passed local and pull request checks.",
    ].join("\n"),
    `Use taskId ${TASK_ID} for every task-bound odt_* tool call.`,
  ].join("\n\n"),
};

/** The review comment on line 10 of the hook. */
export const REVIEW_COMMENT =
  "Also return early when event.defaultPrevented is true. Then a component that handles Cmd+K itself keeps it.";

/** The message that Send builds from the pending comment, as use-inline-comment-draft-store.ts formats it. */
export const REVIEW_MESSAGE = [
  "## Git Diff Comments",
  [
    "### Comment 1",
    "File: `src/search/use-search-shortcut.ts`",
    "Diff: branch changes",
    "Change: added",
    "Lines: 10",
    "Context:",
    "```typescript",
    `10 | ${MODIFIER_CHECK}`,
    "```",
    `Instruction: ${REVIEW_COMMENT}`,
  ].join("\n"),
].join("\n\n");

export const CI_CHECKS = ["lint", "typecheck", "test", "build"];
export const PR_TITLE = "feat(search): open search from anywhere with Cmd+K";

/** The last frame of each workflow step. The next step starts from it. */
export const FRAMES = {
  spec: {
    tones: ["done", "available", "blocked", "blocked"],
    selected: "spec",
    action: "Start Planner",
    actionDisabled: false,
    session: SPEC_SESSION,
    panel: "document",
    checksTab: false,
    focus: "chat",
    nav: studioNav(settled("spec", "spec_ready")),
  },
  plan: {
    tones: ["done", "done", "available", "blocked"],
    selected: "planner",
    action: "Start Implementation",
    actionDisabled: false,
    session: PLANNER_SESSION,
    panel: "document",
    checksTab: false,
    focus: "chat",
    nav: studioNav(settled("planner", "ready_for_dev")),
  },
  build: {
    tones: ["done", "done", "done", "available"],
    selected: "build",
    action: "Request QA Review",
    actionDisabled: false,
    session: BUILDER_SESSION,
    panel: "diffs",
    checksTab: false,
    focus: "chat",
    nav: studioNav(settled("build", "ai_review")),
  },
  qa: {
    tones: ["done", "done", "done", "rejected"],
    selected: "build",
    action: "Request QA Review",
    actionDisabled: false,
    session: BUILDER_FIX_SESSION,
    panel: "diffs",
    checksTab: false,
    focus: "chat",
    nav: studioNav(settled("build", "ai_review")),
  },
  review: {
    tones: ["done", "done", "done", "done"],
    selected: "build",
    action: "Actions",
    actionDisabled: true,
    session: BUILDER_PR_SESSION,
    panel: "ci_checks",
    checksTab: true,
    focus: "panel",
    panelSize: "wide",
    nav: studioNav(),
  },
} as const satisfies Record<string, StudioFrame>;
