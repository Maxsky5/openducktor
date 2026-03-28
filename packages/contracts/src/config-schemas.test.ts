import { describe, expect, test } from "bun:test";
import { AUTOPILOT_EVENT_IDS, repoConfigSchema, settingsSnapshotSchema } from "./config-schemas";

describe("config-schemas", () => {
  test("defaults dev servers to an empty array", () => {
    const parsed = repoConfigSchema.parse({});
    expect(parsed.devServers).toEqual([]);
  });

  test("requires named dev server commands", () => {
    expect(() =>
      repoConfigSchema.parse({
        devServers: [
          {
            id: "frontend",
            name: "",
            command: "bun run dev",
          },
        ],
      }),
    ).toThrow();
  });

  test("trims dev server fields and rejects duplicate ids", () => {
    const parsed = repoConfigSchema.parse({
      devServers: [
        {
          id: " frontend ",
          name: " Frontend ",
          command: " bun run dev ",
        },
      ],
    });

    expect(parsed.devServers).toEqual([
      {
        id: "frontend",
        name: "Frontend",
        command: "bun run dev",
      },
    ]);

    expect(() =>
      repoConfigSchema.parse({
        devServers: [
          { id: "frontend", name: "Frontend", command: "bun run dev" },
          { id: " frontend ", name: "Backend", command: "bun run api" },
        ],
      }),
    ).toThrow("Duplicate dev server id: frontend");
  });

  test("rejects whitespace-only dev server fields", () => {
    expect(() =>
      repoConfigSchema.parse({
        devServers: [{ id: "frontend", name: "Frontend", command: "   " }],
      }),
    ).toThrow("Dev server command cannot be blank.");
  });

  test("defaults kanban done visibility to one day", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      repos: {},
      globalPromptOverrides: {},
    });

    expect(parsed.kanban.doneVisibleDays).toBe(1);
  });

  test("defaults autopilot rules for every supported event", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      repos: {},
      globalPromptOverrides: {},
    });

    expect(parsed.autopilot.rules.map((rule) => rule.eventId)).toEqual([...AUTOPILOT_EVENT_IDS]);
    expect(parsed.autopilot.rules.every((rule) => rule.actionIds.length === 0)).toBe(true);
  });

  test("creates a fresh autopilot default for each parse", () => {
    const first = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      repos: {},
      globalPromptOverrides: {},
    });
    const second = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      repos: {},
      globalPromptOverrides: {},
    });

    expect(first.autopilot).not.toBe(second.autopilot);
    expect(first.autopilot.rules).not.toBe(second.autopilot.rules);
  });

  test("normalizes autopilot rule order and dedupes actions", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      repos: {},
      globalPromptOverrides: {},
      autopilot: {
        rules: [
          {
            eventId: "taskProgressedToHumanReview",
            actionIds: ["startGeneratePullRequest", "startGeneratePullRequest"],
          },
          {
            eventId: "taskProgressedToSpecReady",
            actionIds: ["startPlanner", "startPlanner"],
          },
        ],
      },
    });

    expect(parsed.autopilot.rules).toEqual([
      { eventId: "taskProgressedToSpecReady", actionIds: ["startPlanner"] },
      { eventId: "taskProgressedToReadyForDev", actionIds: [] },
      { eventId: "taskProgressedToAiReview", actionIds: [] },
      { eventId: "taskRejectedByQa", actionIds: [] },
      { eventId: "taskProgressedToHumanReview", actionIds: ["startGeneratePullRequest"] },
    ]);
  });

  test("merges duplicate rules for the same event", () => {
    const parsed = settingsSnapshotSchema.parse({
      theme: "light",
      git: { defaultMergeMethod: "merge_commit" },
      repos: {},
      globalPromptOverrides: {},
      autopilot: {
        rules: [
          {
            eventId: "taskProgressedToSpecReady",
            actionIds: ["startPlanner"],
          },
          {
            eventId: "taskProgressedToSpecReady",
            actionIds: ["startBuilder", "startPlanner"],
          },
        ],
      },
    });

    expect(parsed.autopilot.rules[0]).toEqual({
      eventId: "taskProgressedToSpecReady",
      actionIds: ["startPlanner", "startBuilder"],
    });
  });
});
