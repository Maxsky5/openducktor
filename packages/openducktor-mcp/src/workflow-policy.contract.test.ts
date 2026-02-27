import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { IssueType, TaskCard, TaskStatus } from "./contracts";
import {
  canReplaceEpicSubtaskStatus,
  getSetPlanError,
  getSetSpecError,
  getTransitionError,
} from "./workflow-policy";

type WorkflowContractFixture = {
  statuses: string[];
  transitions: Record<string, Record<string, string[]>>;
  setSpecAllowedStatuses: string[];
  setPlanAllowedStatuses: Record<string, string[]>;
  epicSubtaskReplacementAllowedStatuses: string[];
};

const ISSUE_TYPES: IssueType[] = ["epic", "feature", "task", "bug"];

const loadFixture = (): WorkflowContractFixture => {
  const fixturePath = join(import.meta.dir, "../../../docs/contracts/workflow-contract-fixture.json");
  const raw = readFileSync(fixturePath, "utf8");
  return JSON.parse(raw) as WorkflowContractFixture;
};

const makeTask = (issueType: IssueType, status: TaskStatus): TaskCard => {
  return {
    id: `${issueType}-${status}`,
    title: "Contract fixture task",
    issueType,
    status,
    aiReviewEnabled: true,
    parentId: null,
  };
};

describe("workflow policy contract", () => {
  test("transition matrix matches canonical fixture for every issue type", () => {
    const fixture = loadFixture();

    for (const issueType of ISSUE_TYPES) {
      const issueTransitions = fixture.transitions[issueType];
      expect(issueTransitions).toBeDefined();

      for (const from of fixture.statuses) {
        const task = makeTask(issueType, from as TaskStatus);
        const expectedTargets = new Set(issueTransitions[from] ?? []);

        for (const to of fixture.statuses) {
          const expectedAllowed = from === to || expectedTargets.has(to);
          const actualAllowed =
            getTransitionError(task, [task], from as TaskStatus, to as TaskStatus) === null;

          expect(actualAllowed).toBe(expectedAllowed);
        }
      }
    }
  });

  test("set_spec allowed statuses match canonical fixture", () => {
    const fixture = loadFixture();
    const expected = new Set(fixture.setSpecAllowedStatuses);

    for (const status of fixture.statuses) {
      const actualAllowed = getSetSpecError(status as TaskStatus) === null;
      expect(actualAllowed).toBe(expected.has(status));
    }
  });

  test("set_plan allowed statuses match canonical fixture", () => {
    const fixture = loadFixture();

    for (const issueType of ISSUE_TYPES) {
      const expectedStatuses = new Set(fixture.setPlanAllowedStatuses[issueType] ?? []);
      for (const status of fixture.statuses) {
        const task = makeTask(issueType, status as TaskStatus);
        const actualAllowed = getSetPlanError(task) === null;
        expect(actualAllowed).toBe(expectedStatuses.has(status));
      }
    }
  });

  test("epic subtask replacement statuses match canonical fixture", () => {
    const fixture = loadFixture();
    const expected = new Set(fixture.epicSubtaskReplacementAllowedStatuses);

    for (const status of fixture.statuses) {
      const actualAllowed = canReplaceEpicSubtaskStatus(status as TaskStatus);
      expect(actualAllowed).toBe(expected.has(status));
    }
  });
});
