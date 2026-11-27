import { describe, expect, test } from "bun:test";
import { CREATE_LABELS, NEW_SESSION_SHORTCUT } from "./replicas/shell/CreateMenu";
import { DRAFT_LABELS } from "./replicas/shell/nav";
import { BRANCH_TEXT } from "./replicas/studio/DraftPopovers";
import { ADD_ACTION_LABEL } from "./replicas/studio/RepoActions";
import { DRAFT_TEXT, WORK_LOCATIONS } from "./replicas/studio/SessionDraft";
import { STARTUP_CARD_TITLES } from "./replicas/studio/StartupCard";
import { STEP_STATE_LABELS } from "./replicas/studio/StartupProgress";
import { REPOSITORY_PATH } from "./sample/workspace";
import {
  BRANCH_PLACEHOLDER,
  BRANCH_PREFIX,
  EMPTY_DIFF,
  ENTRY,
  ISSUE_IMPORT,
  STEPS,
  TARGET,
} from "./scenes/new-session/sample";
import { importProduct, readProduct, readProductWords } from "./test-support/product-source";

type Combination = { key: { kind: "logical"; key: string }; ctrl: boolean; shift: boolean };
type Step = { id: string; label: string; state: "pending" | "completed"; details: string[] };
type Phase = "running" | "ready";
type Attempt = {
  id: string;
  origin: { repoPath: string; scope: { kind: "workspace" } };
  status: { phase: Phase };
  instructionRequired: boolean;
  operations: { context: { operationId: string }; steps: Step[] }[];
};
type WorktreeInput = { mode: "from_name"; name: string; branchName: null };

const DRAFT = "packages/frontend/src/pages/workspace-sessions";
const STARTUP = "packages/frontend/src/features/session-startup";

// SAFETY: issue-import-provider.ts exports this function, and a missing export fails the test.
const { issueImportActionLabel } = await importProduct<{
  issueImportActionLabel: (state: {
    kind: "ready";
    provider: { config: { id: string } };
  }) => string;
}>("packages/frontend-core/src/tasks/issue-import/issue-import-provider.ts");
// SAFETY: catalogue.ts exports this function, and a missing export fails the test.
const { commandDefinition } = await importProduct<{
  commandDefinition: (id: string) => { defaultKeys: { electron: Combination } } | undefined;
}>("packages/frontend/src/features/shortcuts/catalogue.ts");
// SAFETY: key-labels.ts exports this function, and a missing export fails the test.
const { shortcutLabel } = await importProduct<{
  shortcutLabel: (combination: Combination, platform: "darwin" | "win32") => string;
}>("packages/frontend-core/src/shortcuts/key-labels.ts");
// SAFETY: workspace-session-worktree-rules.ts exports this function, and a missing export fails
// the test.
const { newWorktreeBranchState } = await importProduct<{
  newWorktreeBranchState: (value: WorktreeInput, prefix: string) => { defaultBranch: string };
}>("packages/frontend-core/src/workspace-sessions/create/workspace-session-worktree-rules.ts");
// SAFETY: the contracts export this value, and a missing export fails the test.
const { DEFAULT_BRANCH_PREFIX } = await importProduct<{ DEFAULT_BRANCH_PREFIX: string }>(
  "packages/contracts/src/index.ts",
);
// SAFETY: branch-naming.ts exports this function, and a missing export fails the test.
const { branchNamingStep } = await importProduct<{
  branchNamingStep: (
    config: { namingModel: { runtimeKind: string; modelId: string } },
    withTitle: boolean,
  ) => { id: string; label: string };
}>("packages/host/src/application/naming/branch-naming.ts");
// SAFETY: worktree-setup-plan.ts exports this function, and a missing export fails the test.
const { buildWorktreeSetupPlanSteps } = await importProduct<{
  buildWorktreeSetupPlanSteps: (input: {
    label: string;
    worktreePath: string;
    branch: null;
    namingStep: { id: string; label: string; state: "pending" };
    upstreamRemote: undefined;
    repoConfig: { worktreeCopyPaths: string[]; actions: { items: [] } };
  }) => (Omit<Step, "details"> & { details?: string[] })[];
}>("packages/host/src/application/agent-sessions/worktree-setup-plan.ts");
// SAFETY: startup-trace.ts exports these functions, and a missing export fails the test.
const trace = await importProduct<{
  startupTraceRows: (attempt: Attempt) => { step: Step }[];
  startupStepHasDetails: (step: Step) => boolean;
}>("packages/frontend-core/src/sessions/startup/startup-trace.ts");
// SAFETY: startup-summary.ts exports this function, and a missing export fails the test.
const { startupTitle } = await importProduct<{ startupTitle: (attempt: Attempt) => string }>(
  `${STARTUP}/startup-summary.ts`,
);

// SAFETY: empty-diff-copy.ts exports this function, and a missing export fails the test.
const { emptyDiffCopy } = await importProduct<{
  emptyDiffCopy: (input: {
    targetBranch: string;
    isLoading: boolean;
    contextMode: "worktree";
    diffScope: "target";
    upstreamStatus: undefined;
  }) => { title: string; description: string | null };
}>("packages/frontend-core/src/git/model/empty-diff-copy.ts");

const WORKSPACES = "packages/host/src/application/workspaces";

/** The first match of `pattern` in `text`. */
function matchOf(text: string, pattern: RegExp): RegExpMatchArray {
  const match = text.match(pattern);
  if (!match) throw new Error(`The product source has no match for ${pattern}.`);
  return match;
}

/**
 * The steps that workspace-session-launch-service.ts and workspace-session-target.ts give a new
 * worktree with a naming model, in their order: the runtime check, the plan of the worktree with
 * the naming step, and the tail steps of the session. The labels come from the product source.
 */
async function plannedSteps(): Promise<Step[]> {
  const [launch, target] = await Promise.all([
    readProductWords([`${WORKSPACES}/workspace-session-launch-service.ts`]),
    readProductWords([`${WORKSPACES}/workspace-session-target.ts`]),
  ]);
  const [, checks = ""] = matchOf(launch, /startupStep\( \{ id: "checks", label: "([^"]+)" \}/);
  const [, tail = ""] = matchOf(launch, /const SESSION_TAIL_STEPS = \[(.*?)\] as const;/);
  const [, worktree = ""] = matchOf(target, /buildWorktreeSetupPlanSteps\(\{ label: "([^"]+)"/);
  const naming = branchNamingStep({ namingModel: { runtimeKind: "codex", modelId: "m" } }, true);
  const plan = buildWorktreeSetupPlanSteps({
    label: worktree,
    worktreePath: `${REPOSITORY_PATH}-worktrees/w`,
    branch: null,
    namingStep: { ...naming, state: "pending" },
    upstreamRemote: undefined,
    repoConfig: { worktreeCopyPaths: [], actions: { items: [] } },
  });
  const tailSteps = [...tail.matchAll(/\{ id: "(\w+)", label: "([^"]+)"/g)].map(
    ([, id = "", label = ""]) => ({ id, label }),
  );
  return [{ id: "checks", label: checks }, ...plan, ...tailSteps].map((step) => ({
    details: [],
    ...step,
    state: "pending",
  }));
}

/**
 * The start of the session with the planned steps. With `done`, each step completed, and the
 * naming step and the message have their details, as the host gives them when they complete.
 */
function attempt(steps: readonly Step[], phase: Phase, done = false): Attempt {
  const completed = (step: Step): Step => ({
    ...step,
    state: "completed",
    details: step.id === "naming" || step.id === "instruction" ? ["done"] : step.details,
  });
  return {
    id: "attempt",
    origin: { repoPath: REPOSITORY_PATH, scope: { kind: "workspace" } },
    status: { phase },
    instructionRequired: true,
    operations: [
      { context: { operationId: "launch" }, steps: done ? steps.map(completed) : [...steps] },
    ],
  };
}

describe("the new session copied from the app", () => {
  test("the menu has the labels of the app and the shortcut of New session", async () => {
    expect(issueImportActionLabel({ kind: "ready", provider: { config: { id: "github" } } })).toBe(
      ISSUE_IMPORT,
    );
    const keys = commandDefinition("new-chat")?.defaultKeys.electron;
    if (!keys) throw new Error("The new-chat command has no default keys.");
    expect(shortcutLabel(keys, "darwin")).toBe(NEW_SESSION_SHORTCUT.mac);
    expect(shortcutLabel(keys, "win32")).toBe(NEW_SESSION_SHORTCUT.pc);
    const menu = await readProduct(
      "packages/frontend/src/components/layout/sidebar/session-create-split-action.tsx",
    );
    for (const label of Object.values(CREATE_LABELS)) expect(menu).toContain(`label="${label}"`);
  });

  test("the draft page, its options, and the branch popover use the words of the app", async () => {
    const words = await readProductWords([
      `${DRAFT}/workspace-session-draft-view.tsx`,
      `${DRAFT}/workspace-session-draft-config-bar.tsx`,
      `${DRAFT}/workspace-session-draft-worktree-sections.tsx`,
    ]);
    const shown = [
      `> ${DRAFT_TEXT.title} </h1>`,
      `<span>${DRAFT_TEXT.discard}</span>`,
      `<h2>${DRAFT_TEXT.heading}</h2>`,
      DRAFT_TEXT.lead,
      `<span>${DRAFT_TEXT.sending}</span>`,
      `label: "${DRAFT_TEXT.autoBranch}"`,
      `label: "${DRAFT_TEXT.noRole}"`,
      `> ${BRANCH_TEXT.newBranch} </TabsTrigger>`,
      `> ${BRANCH_TEXT.existingBranch} </TabsTrigger>`,
      `> ${BRANCH_TEXT.branchName} </Label>`,
      `emptyHint="${BRANCH_TEXT.emptyHint}"`,
      `<span>${BRANCH_TEXT.customFolder}</span>`,
    ];
    for (const word of shown) expect(words).toContain(word);
    // The work locations come in the order of LOCATION_OPTIONS.
    const places = WORK_LOCATIONS.map((option) =>
      words.indexOf(
        `value: "${option.value}", label: "${option.label}", description: "${option.description}"`,
      ),
    );
    expect(places.every((place) => place >= 0)).toBe(true);
    expect(places).toEqual(places.toSorted((a, b) => a - b));
    const core = await readProduct(
      "packages/frontend-core/src/workspace-sessions/create/use-workspace-session-draft-core.ts",
    );
    expect(core).toContain(`if (isStarting) return "${DRAFT_TEXT.starting}";`);
    expect(core).toContain(`{ value: NO_CUSTOM_AGENT_ROLE, label: "${DRAFT_TEXT.noRole}" }`);
  });

  test("an empty branch name shows the default prefix in its placeholder", async () => {
    expect(BRANCH_PREFIX).toBe(DEFAULT_BRANCH_PREFIX);
    const empty: WorktreeInput = { mode: "from_name", name: "", branchName: null };
    expect(newWorktreeBranchState(empty, BRANCH_PREFIX).defaultBranch).toBe("");
    const sections = await readProduct(`${DRAFT}/workspace-session-draft-worktree-sections.tsx`);
    expect(sections).toContain('defaultBranch || `${branchPrefix?.trim() || "feat"}/my-branch`');
    expect(BRANCH_PLACEHOLDER).toBe(`${BRANCH_PREFIX}/my-branch`);
  });

  test("the sidebar marks the draft and the session that starts, without the default runtime", async () => {
    const list = await readProduct(
      "packages/frontend/src/components/layout/sidebar/session-navigation-list.tsx",
    );
    expect(list).toContain(`? "${DRAFT_LABELS.starting}" : "${DRAFT_LABELS.draft}"`);
    const readModel = await readProduct(
      "packages/frontend-core/src/sessions/navigation/session-navigation-read-model.ts",
    );
    expect(readModel).toContain("runtimeKind: draft.options.selectedModel?.runtimeKind ?? null,");
    const [readWords, entryWords] = await Promise.all([
      readProductWords([
        "packages/frontend-core/src/sessions/navigation/session-navigation-read-model.ts",
      ]),
      readProductWords([
        "packages/frontend/src/components/layout/sidebar/session-navigation-entry-model.ts",
      ]),
    ]);
    expect(readWords).toContain('status: isStarting ? { kind: "running" }');
    expect(entryWords).toContain("entry.context.isStarting ? MessagesSquare : MessageCirclePlus");
    const drafts = await readProduct(
      "packages/frontend-core/src/drafts/new-workspace-session-draft-store.ts",
    );
    expect(drafts).toContain(`return "${ENTRY.title}";`);
  });

  test("the startup card shows the steps of a new worktree with a naming model", async () => {
    const steps = await plannedSteps();
    const rows = trace.startupTraceRows(attempt(steps, "running")).map(({ step }) => step);
    expect(rows.map((step) => step.id)).toEqual(STEPS.map((step) => step.id));
    expect(rows.map((step) => step.label)).toEqual(STEPS.map((step) => step.label));
    expect(rows.map((step) => trace.startupStepHasDetails(step))).toEqual(
      STEPS.map((step) => step.details === true),
    );
    const completed = trace.startupTraceRows(attempt(steps, "ready", true)).map(({ step }) => step);
    expect(completed.map((step) => trace.startupStepHasDetails(step))).toEqual(
      STEPS.map((step) => step.details !== false),
    );
  });

  test("the Diffs panel of the new worktree has no changes against the target branch", () => {
    expect(
      emptyDiffCopy({
        targetBranch: TARGET,
        isLoading: false,
        contextMode: "worktree",
        diffScope: "target",
        upstreamStatus: undefined,
      }),
    ).toEqual({ title: EMPTY_DIFF, description: null });
  });

  test("the top bar of a session in a repository without actions offers Add action", async () => {
    const button = await readProduct(
      "packages/frontend/src/components/features/repository-actions/repo-actions-split-button.tsx",
    );
    expect(button).toContain(`aria-label="${ADD_ACTION_LABEL}"`);
    expect(button).toContain(
      `<span className="@max-[640px]/session-header:hidden">${ADD_ACTION_LABEL}</span>`,
    );
  });

  test("the step rows name the pending and the running steps", async () => {
    const rows = await readProduct(`${STARTUP}/session-startup-trace.tsx`);
    expect(rows).toContain(`pending: { label: "${STEP_STATE_LABELS.pending}", icon: Circle }`);
    expect(rows).toContain(
      `running: { label: "${STEP_STATE_LABELS.running}", icon: LoaderCircle }`,
    );
  });

  test("the startup card names the start and the ready session", async () => {
    const steps = await plannedSteps();
    expect(startupTitle(attempt(steps, "running"))).toBe(STARTUP_CARD_TITLES.running);
    expect(startupTitle(attempt(steps, "ready", true))).toBe(STARTUP_CARD_TITLES.ready);
  });
});
