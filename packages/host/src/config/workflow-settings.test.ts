import { describe, expect, test } from "bun:test";
import {
  type codexRuntimeConfigSchema,
  globalConfigSchema,
  repoConfigSchema,
} from "@openducktor/contracts";
import { createReviewTaskWorkflow } from "@openducktor/workflows/test-support";
import type { z } from "zod";
import { singleTaskWorkflow } from "../test-support/task-workflows";
import { applyTaskWorkflowSettings } from "./workflow-settings";

const review = createReviewTaskWorkflow();
const reviewWorkflows = singleTaskWorkflow(review);

const config = (input: Partial<z.input<typeof globalConfigSchema>> = {}) =>
  globalConfigSchema.parse({ version: 4, ...input });

const workspace = (input: Partial<z.input<typeof repoConfigSchema>> = {}) =>
  repoConfigSchema.parse({
    workspaceId: "repo",
    workspaceName: "Repo",
    repoPath: "/repo",
    agentStudioState: { openTaskIds: [] },
    ...input,
  });

describe("applyTaskWorkflowSettings", () => {
  test("adds the notifications and Autopilot rules of the workflow", () => {
    const applied = applyTaskWorkflowSettings(
      config({
        autopilot: { rules: [{ eventId: "reviewRejected", actionIds: ["startRevision"] }] },
      }),
      reviewWorkflows,
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
      { eventId: "draftSubmitted", actionIds: [] },
      { eventId: "reviewAccepted", actionIds: [] },
      { eventId: "reviewRejected", actionIds: ["startRevision"] },
    ]);
  });

  test("rejects settings keys outside the workflow", () => {
    expect(() =>
      applyTaskWorkflowSettings(
        config({ autopilot: { rules: [{ eventId: "taskRejectedByQa", actionIds: [] }] } }),
        reviewWorkflows,
      ),
    ).toThrow('Unknown Autopilot event "taskRejectedByQa"');
    expect(() =>
      applyTaskWorkflowSettings(
        config({
          globalPromptOverrides: { "kickoff.qa_review": { template: "x", baseVersion: 1 } },
        }),
        reviewWorkflows,
      ),
    ).toThrow('Unknown prompt template "kickoff.qa_review"');
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

    expect(() => applyTaskWorkflowSettings(codex("writer"), reviewWorkflows)).toThrow(
      "Codex writer role sandboxMode cannot be read-only",
    );
    expect(
      applyTaskWorkflowSettings(codex("editor"), reviewWorkflows).agentRuntimes.codex.roleOverrides,
    ).toEqual({ editor: { sandboxMode: "read-only" } });
  });
});
