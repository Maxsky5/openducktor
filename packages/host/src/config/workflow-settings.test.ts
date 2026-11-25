import { describe, expect, test } from "bun:test";
import {
  type antigravityRuntimeConfigSchema,
  type codexRuntimeConfigSchema,
  globalConfigSchema,
  notificationSettingsSchema,
  promptOverrideKey,
  workflowDefinitionSchema,
  repoConfigSchema,
} from "@openducktor/contracts";
import {
  specPlanBuildPromptKey,
  createReviewTaskWorkflow,
  reviewTaskRoles,
} from "@openducktor/workflows/test-support";
import { createTaskWorkflow } from "@openducktor/workflows";
import type { z } from "zod";
import {
  applyTaskWorkflowSettings,
  savedWorkflowSettingKeys,
  type WorkflowSettingsMode,
  type WorkflowSettingsSource,
} from "./workflow-settings";
import { repoConfigFixture } from "../test-support/repo-config-fixture";
import { builtinWorkflowSettingsOwners } from "../test-support/task-workflows";

const review = createReviewTaskWorkflow();
/** The host knows the review workflow and its roles only. */
const reviewWorkflows: WorkflowSettingsSource = { latest: [review], roles: reviewTaskRoles };
const save: WorkflowSettingsMode = {
  saved: { prompts: new Set(), notificationKinds: new Set(), autopilotRules: new Map() },
};

const config = (input: Partial<z.input<typeof globalConfigSchema>> = {}) =>
  globalConfigSchema.parse({ version: 4, ...input });

const workspace = (input: Partial<z.input<typeof repoConfigSchema>> = {}) =>
  repoConfigFixture({
    agentStudioState: { openTaskIds: [] },
    ...input,
  });

describe("applyTaskWorkflowSettings", () => {
  test("keeps rules with equal signal IDs in separate workflows", () => {
    const second = createTaskWorkflow(
      workflowDefinitionSchema.parse({ ...review.definition, id: "another-review" }),
      review.workflowTemplates,
      reviewTaskRoles,
    );
    const applied = applyTaskWorkflowSettings(
      config({
        autopilot: {
          rules: [
            {
              workflowId: review.definition.id,
              eventId: "reviewRejected",
              actionIds: ["startRevision"],
            },
            { workflowId: second.definition.id, eventId: "reviewRejected", actionIds: [] },
          ],
        },
      }),
      { latest: [review, second], roles: reviewTaskRoles },
      save,
    );
    expect(applied.autopilot.rules.filter((rule) => rule.eventId === "reviewRejected")).toEqual([
      { workflowId: review.definition.id, eventId: "reviewRejected", actionIds: ["startRevision"] },
      { workflowId: second.definition.id, eventId: "reviewRejected", actionIds: [] },
    ]);
    expect(() =>
      applyTaskWorkflowSettings(
        config({
          autopilot: {
            rules: [{ workflowId: "missing", eventId: "reviewRejected", actionIds: [] }],
          },
        }),
        reviewWorkflows,
        save,
      ),
    ).toThrow('Unknown Autopilot workflow "missing"');
  });
  test("adds the notifications and Autopilot rules of the workflow", () => {
    const applied = applyTaskWorkflowSettings(
      config({
        autopilot: {
          rules: [
            {
              workflowId: review.definition.id,
              eventId: "reviewRejected",
              actionIds: ["startRevision"],
            },
          ],
        },
      }),
      reviewWorkflows,
      save,
    );

    expect(applied.notifications.kinds["workflow.reviewing"]).toEqual({
      enabled: true,
      target: "both",
      sound: "inherit",
    });
    expect(applied.notifications.kinds["workflow.published"]).toEqual({
      enabled: true,
      target: "in_app",
      sound: "none",
    });
    expect(applied.autopilot.rules).toEqual([
      { workflowId: review.definition.id, eventId: "draftSubmitted", actionIds: [] },
      { workflowId: review.definition.id, eventId: "reviewAccepted", actionIds: [] },
      { workflowId: review.definition.id, eventId: "reviewRejected", actionIds: ["startRevision"] },
    ]);
  });

  test("adds the default of a task notification that a saved config lacks", () => {
    const saved = config();
    const { "task.auto_close_blocked": _removed, ...kinds } = saved.notifications.kinds;
    // A parse keeps the missing kind missing, as for a config file from before the kind.
    const notifications = notificationSettingsSchema.parse({ ...saved.notifications, kinds });
    const applied = applyTaskWorkflowSettings({ ...saved, notifications }, reviewWorkflows, save);

    expect(applied.notifications.kinds["task.auto_close_blocked"]).toEqual({
      enabled: true,
      target: "both",
      sound: "inherit",
    });
  });

  test("rejects settings keys outside the workflow", () => {
    expect(() =>
      applyTaskWorkflowSettings(
        config({
          autopilot: {
            rules: [
              { workflowId: review.definition.id, eventId: "taskRejectedByQa", actionIds: [] },
            ],
          },
        }),
        reviewWorkflows,
        save,
      ),
    ).toThrow('Unknown Autopilot event "taskRejectedByQa"');
    expect(() =>
      applyTaskWorkflowSettings(
        config({
          globalPromptOverrides: {
            [specPlanBuildPromptKey("messages.qa_review")]: { template: "x", baseVersion: 1 },
          },
        }),
        reviewWorkflows,
        save,
      ),
    ).toThrow(`Unknown prompt "${specPlanBuildPromptKey("messages.qa_review")}"`);
    expect(() =>
      applyTaskWorkflowSettings(
        config({
          workspaces: {
            repo: workspace({
              agentDefaults: {
                build: { runtimeKind: "codex", providerId: "openai", modelId: "gpt" },
              },
            }),
          },
        }),
        reviewWorkflows,
        save,
      ),
    ).toThrow('Unknown role "build" at workspaces.repo.agentDefaults');
  });

  test("keeps a writing role out of a read-only Codex sandbox", () => {
    const codex = (role: string) => {
      const runtime: z.input<typeof codexRuntimeConfigSchema> = {
        enabled: true,
        executablePath: "/bin/codex",
        roleOverrides: { [role]: { sandboxMode: "read-only" } },
      };
      return config({ agentRuntimes: { codex: runtime } });
    };

    expect(() => applyTaskWorkflowSettings(codex("writer"), reviewWorkflows, save)).toThrow(
      "Codex writer role sandboxMode cannot be read-only",
    );
    expect(
      applyTaskWorkflowSettings(codex("editor"), reviewWorkflows, save).agentRuntimes.codex
        .roleOverrides,
    ).toEqual({ editor: { sandboxMode: "read-only" } });
  });

  test("accepts any Antigravity mode for a read-only role", () => {
    const runtime: z.input<typeof antigravityRuntimeConfigSchema> = {
      enabled: true,
      executablePath: "/bin/agy",
      roleOverrides: { editor: { mode: "auto" } },
    };

    expect(
      applyTaskWorkflowSettings(
        config({ agentRuntimes: { antigravity: runtime } }),
        reviewWorkflows,
        save,
      ).agentRuntimes.antigravity.roleOverrides,
    ).toEqual({ editor: { mode: "auto" } });
  });

  test("a read and a save keep an Agent Studio selection of a deleted role", () => {
    const selected = config({
      workspaces: {
        repo: workspace({
          agentStudioState: { openTaskIds: [], activeTask: { taskId: "t1", role: "gone" } },
        }),
      },
    });
    expect(applyTaskWorkflowSettings(selected, reviewWorkflows, "read")).toBeDefined();
    expect(applyTaskWorkflowSettings(selected, reviewWorkflows, save)).toBeDefined();
  });

  test("a read accepts the keys of an older version of a custom workflow", () => {
    const olderPrompt = promptOverrideKey({
      ownerKind: "workflow",
      ownerId: review.definition.id,
      promptId: "messages.removed_step",
    });
    const saved = config({
      globalPromptOverrides: { [olderPrompt]: { template: "x", baseVersion: 1 } },
      autopilot: {
        rules: [
          { workflowId: review.definition.id, eventId: "removedSignal", actionIds: ["gone"] },
        ],
      },
    });

    const applied = applyTaskWorkflowSettings(saved, reviewWorkflows, "read");
    expect(applied.globalPromptOverrides[olderPrompt]).toEqual({ template: "x", baseVersion: 1 });
    // The latest version gives its rules; the rule of the older signal follows, so it still applies.
    expect(applied.autopilot.rules.map(({ eventId }) => eventId)).toEqual([
      "draftSubmitted",
      "reviewAccepted",
      "reviewRejected",
      "removedSignal",
    ]);
    expect(() => applyTaskWorkflowSettings(saved, reviewWorkflows, save)).toThrow(
      `Unknown prompt "${olderPrompt}"`,
    );
    const resaved = applyTaskWorkflowSettings(applied, reviewWorkflows, {
      saved: savedWorkflowSettingKeys(saved),
    });
    expect(resaved.globalPromptOverrides[olderPrompt]).toEqual({ template: "x", baseVersion: 1 });
    expect(resaved.autopilot.rules.at(-1)).toEqual({
      workflowId: review.definition.id,
      eventId: "removedSignal",
      actionIds: ["gone"],
    });
  });

  test("a save keeps saved actions of an older version on a signal that still exists", () => {
    const saved = config({
      autopilot: {
        rules: [
          {
            workflowId: review.definition.id,
            eventId: "reviewRejected",
            actionIds: ["removedAction"],
          },
        ],
      },
    });
    const applied = applyTaskWorkflowSettings(saved, reviewWorkflows, "read");
    const resaved = applyTaskWorkflowSettings(applied, reviewWorkflows, {
      saved: savedWorkflowSettingKeys(saved),
    });
    expect(
      resaved.autopilot.rules.find(({ eventId }) => eventId === "reviewRejected")?.actionIds,
    ).toEqual(["removedAction"]);
    const added = structuredClone(applied);
    added.autopilot.rules.find(({ eventId }) => eventId === "reviewAccepted")!.actionIds = [
      "removedAction",
    ];
    expect(() =>
      applyTaskWorkflowSettings(added, reviewWorkflows, { saved: savedWorkflowSettingKeys(saved) }),
    ).toThrow('Unknown Autopilot action "removedAction"');
  });

  test("a save keeps a saved notification kind that no latest version declares", () => {
    const kind = "workflow.design_ready";
    const saved = config();
    saved.notifications.kinds[kind] = { enabled: true, target: "both", sound: "inherit" };
    const applied = applyTaskWorkflowSettings(saved, reviewWorkflows, "read");
    expect(() =>
      applyTaskWorkflowSettings(applied, reviewWorkflows, {
        saved: savedWorkflowSettingKeys(saved),
      }),
    ).not.toThrow();
    expect(() => applyTaskWorkflowSettings(applied, reviewWorkflows, save)).toThrow(
      `Unknown notification "${kind}"`,
    );
  });

  test("a read checks the keys of the built-in workflow against its own IDs", () => {
    expect(() =>
      applyTaskWorkflowSettings(
        config({
          globalPromptOverrides: {
            [specPlanBuildPromptKey("messages.unknown")]: { template: "x", baseVersion: 1 },
          },
        }),
        builtinWorkflowSettingsOwners,
        "read",
      ),
    ).toThrow(`Unknown prompt "${specPlanBuildPromptKey("messages.unknown")}"`);
  });

  test("checks role keys against the role catalog", () => {
    const instructions = promptOverrideKey({
      ownerKind: "role",
      ownerId: "writer",
      promptId: "instructions",
    });
    expect(
      applyTaskWorkflowSettings(
        config({ globalPromptAppends: { [instructions]: { text: "More", enabled: true } } }),
        reviewWorkflows,
        save,
      ).globalPromptAppends[instructions],
    ).toEqual({ text: "More", enabled: true });
    const unknown = promptOverrideKey({
      ownerKind: "role",
      ownerId: "ghost",
      promptId: "instructions",
    });
    expect(() =>
      applyTaskWorkflowSettings(
        config({ globalPromptAppends: { [unknown]: { text: "More", enabled: true } } }),
        reviewWorkflows,
        "read",
      ),
    ).toThrow(`Unknown prompt "${unknown}"`);
  });
});

describe("naming prompt settings", () => {
  const branchKey = '["feature","naming","branch-name"]';

  test("accepts naming prompt layers with the work text", () => {
    expect(() =>
      applyTaskWorkflowSettings(
        config({
          globalPromptOverrides: {
            [branchKey]: { template: "Team rules.\n{{workText}}", baseVersion: 1 },
          },
          workspaces: {
            repo: workspace({
              promptAppends: { [branchKey]: { text: "Use Jira keys.", enabled: true } },
            }),
          },
        }),
        reviewWorkflows,
        save,
      ),
    ).not.toThrow();
  });

  test.each([
    ["an unknown placeholder", "{{workText}} {{task.unknown}}", "Unsupported placeholder"],
    ["a placeholder that naming cannot fill", "{{workText}} {{task.id}}", "cannot fill"],
    ["no work text", "Team rules.", "Missing required placeholder"],
  ])("rejects a naming override with %s", (_case, template, problem) => {
    expect(() =>
      applyTaskWorkflowSettings(
        config({ globalPromptOverrides: { [branchKey]: { template, baseVersion: 1 } } }),
        reviewWorkflows,
        save,
      ),
    ).toThrow(problem);
  });

  test("rejects a workspace naming append with an unknown placeholder", () => {
    expect(() =>
      applyTaskWorkflowSettings(
        config({
          workspaces: {
            repo: workspace({
              promptAppends: { [branchKey]: { text: "{{nope}}", enabled: true } },
            }),
          },
        }),
        reviewWorkflows,
        save,
      ),
    ).toThrow('The repository append of prompt "Branch name" has a placeholder problem.');
  });
});
