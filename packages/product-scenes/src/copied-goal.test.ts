import { describe, expect, test } from "bun:test";
import { GOAL_MODE_LAUNCHES } from "./replicas/studio/GoalField";
import {
  GOAL_ACTION_LABELS,
  GOAL_STATUS_LABELS,
  GOAL_STATUS_TONES,
  type GoalStatus,
} from "./replicas/studio/GoalRow";
import { GOAL_CHIP_LABEL } from "./replicas/transcript/ReferenceChip";
import { COMPACT_COMMAND, GOAL_COMMAND, SLASH_COMMANDS } from "./scenes/composer/sample";
import { COMMAND_SESSION, GOAL_COMMAND as COMMAND_OF_SCENE } from "./scenes/goal-command/sample";
import { DEFAULT_GOAL, GOAL_SESSION } from "./scenes/goal-mode/sample";
import { TASK_ID } from "./sample/studio";
import { TASKS } from "./sample/tasks";
import { importProduct } from "./test-support/product-source";

type SlashCommand = {
  id: string;
  trigger: string;
  title: string;
  description: string;
  source: string;
  hints: string[];
};
type GoalRowOf = {
  statusLabel: string;
  tone: string;
  actions: readonly string[];
};
type LaunchAction = { id: string; label: string; goal?: { defaultObjective: string } };
type Capabilities = { goals: { supportsPauseResume: boolean } };

// SAFETY: slash-command-schemas.ts exports these commands, and a missing export fails the test.
const commands = await importProduct<{
  GOAL_SLASH_COMMAND: SlashCommand;
  MANUAL_SESSION_COMPACTION_SLASH_COMMAND: SlashCommand;
}>("packages/contracts/src/slash-command-schemas.ts");
// SAFETY: use-chat-composer-slash-commands.ts exports this function.
const { mergeSlashCommands } = await importProduct<{
  mergeSlashCommands: (
    runtime: SlashCommand[],
    prompts: SlashCommand[],
    system: SlashCommand[],
  ) => SlashCommand[];
}>("packages/frontend-core/src/sessions/composer/prompt-input/use-chat-composer-slash-commands.ts");
// SAFETY: agent-session-goal-row.ts exports these values.
const goalRow = await importProduct<{
  buildAgentSessionGoalRow: (
    goal: { objective: string; status: GoalStatus },
    supportsPauseResume: boolean,
  ) => GoalRowOf;
  AGENT_SESSION_GOAL_ACTION_LABELS: Record<string, string>;
}>("packages/frontend-core/src/sessions/goals/agent-session-goal-row.ts");
// SAFETY: agent-chat-goal-chip-markup.ts exports the chip label.
const { AGENT_CHAT_GOAL_CHIP_LABEL } = await importProduct<{ AGENT_CHAT_GOAL_CHIP_LABEL: string }>(
  "packages/frontend/src/components/features/agents/agent-chat/agent-chat-goal-chip-markup.ts",
);
// SAFETY: definition.ts exports the built-in workflow.
const { SPEC_PLAN_BUILD_DEFINITION } = await importProduct<{
  SPEC_PLAN_BUILD_DEFINITION: { steps: { launchActions?: LaunchAction[] }[] };
}>("packages/workflows/src/builtin/spec-plan-build/definition.ts");
// SAFETY: runtime-descriptors.ts exports the capabilities of each runtime.
const runtimes = await importProduct<{
  CODEX_RUNTIME_CAPABILITIES: Capabilities;
  OPENCODE_RUNTIME_CAPABILITIES: Capabilities;
  CLAUDE_RUNTIME_CAPABILITIES: Capabilities;
}>("packages/contracts/src/runtime-descriptors.ts");
// SAFETY: codex-app-server-request-schemas.ts exports the goal states of Codex.
const { codexAppServerThreadGoalStatusSchema } = await importProduct<{
  codexAppServerThreadGoalStatusSchema: { options: readonly string[] };
}>("packages/contracts/src/codex-app-server-request-schemas.ts");

const STATUSES: readonly GoalStatus[] = [
  "active",
  "paused",
  "blocked",
  "limit_reached",
  "complete",
  "waiting_for_message",
  "ended",
];
const LAUNCHES = SPEC_PLAN_BUILD_DEFINITION.steps.flatMap((step) => step.launchActions ?? []);

describe("the goal copied from the app", () => {
  test("the /goal command has the trigger, the source, the hints, and the text of the app", () => {
    const { trigger, source: kind, description, hints } = commands.GOAL_SLASH_COMMAND;
    const copied = [trigger, kind, description, hints.join(" ")];
    for (const command of [GOAL_COMMAND, COMMAND_OF_SCENE])
      expect([command.trigger, command.source, command.description, command.hint]).toEqual(copied);
  });

  test("the slash menu lists /compact, then /goal, as the composer merges them", () => {
    const merged = mergeSlashCommands(
      [commands.MANUAL_SESSION_COMPACTION_SLASH_COMMAND],
      [],
      [commands.GOAL_SLASH_COMMAND],
    );
    expect(merged.map((command) => command.trigger)).toEqual(
      [COMPACT_COMMAND, GOAL_COMMAND].map((command) => command.trigger),
    );
    expect(SLASH_COMMANDS.slice(0, 2)).toEqual([COMPACT_COMMAND, GOAL_COMMAND]);
  });

  test("the goal chip has the label of the app", () => {
    expect(GOAL_CHIP_LABEL).toBe(AGENT_CHAT_GOAL_CHIP_LABEL);
  });

  test("each goal status has the label and the tone of the app", () => {
    for (const status of STATUSES) {
      const row = goalRow.buildAgentSessionGoalRow({ objective: "o", status }, true);
      expect(row.statusLabel).toBe(GOAL_STATUS_LABELS[status]);
      expect(row.tone).toBe(GOAL_STATUS_TONES[status]);
    }
  });

  test("the goal row actions have the labels of the app", () => {
    const labels = Object.entries(goalRow.AGENT_SESSION_GOAL_ACTION_LABELS).map(
      ([action, label]) => [action, `${label} goal`],
    );
    expect(Object.fromEntries(labels)).toEqual(GOAL_ACTION_LABELS);
    const actions = (status: GoalStatus, pausable: boolean): readonly string[] =>
      goalRow.buildAgentSessionGoalRow({ objective: "o", status }, pausable).actions;
    expect(actions("active", true)).toEqual(["pause", "clear"]);
    expect(actions("paused", true)).toEqual(["resume", "clear"]);
    expect(actions("complete", true)).toEqual(["clear"]);
    expect(actions("active", false)).toEqual(["clear"]);
  });

  test("the runtimes of the scenes can pause a goal, and Codex reports a met goal", () => {
    expect(GOAL_SESSION.runtime).toBe("codex");
    expect(runtimes.CODEX_RUNTIME_CAPABILITIES.goals.supportsPauseResume).toBe(true);
    expect(codexAppServerThreadGoalStatusSchema.options).toContain("complete");
    expect(COMMAND_SESSION.runtime).toBe("opencode");
    expect(runtimes.OPENCODE_RUNTIME_CAPABILITIES.goals.supportsPauseResume).toBe(true);
    expect(runtimes.CLAUDE_RUNTIME_CAPABILITIES.goals.supportsPauseResume).toBe(false);
  });

  test("only the launches with a goal offer Goal mode", () => {
    const offered = LAUNCHES.filter((launch) => launch.goal).map((launch) => launch.label);
    expect(offered).toEqual([...GOAL_MODE_LAUNCHES]);
  });

  test("Start Implementation fills the default goal of the workflow", () => {
    const launch = LAUNCHES.find((item) => item.id === "build_implementation_start");
    const objective = launch?.goal?.defaultObjective
      .replaceAll("{{task.id}}", TASK_ID)
      .replaceAll("{{task.title}}", TASKS.k3x9.title);
    expect(objective).toBe(DEFAULT_GOAL);
  });
});
