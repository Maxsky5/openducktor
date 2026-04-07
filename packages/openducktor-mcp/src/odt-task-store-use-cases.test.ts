import { describe, expect, test } from "bun:test";
import type { PublicTask, RawIssue, TaskCard } from "./contracts";
import {
  BuildBlockedUseCase,
  BuildCompletedUseCase,
  BuildResumedUseCase,
  CreateTaskUseCase,
  QaApprovedUseCase,
  QaRejectedUseCase,
  ReadTaskDocumentsUseCase,
  ReadTaskUseCase,
  SearchTasksUseCase,
  SetPlanUseCase,
  SetPullRequestUseCase,
  SetSpecUseCase,
} from "./odt-task-store-use-cases";

const FIXED_TIMESTAMP = "2026-03-01T00:00:00.000Z";

const makeTask = (overrides: Partial<TaskCard> = {}): TaskCard => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status: "open",
  issueType: "feature",
  aiReviewEnabled: true,
  documentSummary: {
    spec: { has: false },
    plan: { has: false },
    qaReport: { has: false, verdict: "not_reviewed" },
  },
  ...overrides,
});

const makeIssue = (overrides: Partial<RawIssue> = {}): RawIssue => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status: "open",
  priority: 2,
  issue_type: "feature",
  labels: [],
  created_at: FIXED_TIMESTAMP,
  updated_at: FIXED_TIMESTAMP,
  metadata: {},
  ...overrides,
});

const makePublicTask = (overrides: Partial<PublicTask> = {}): PublicTask => ({
  id: "task-1",
  title: "Task 1",
  description: "",
  status: "open",
  priority: 2,
  issueType: "feature",
  aiReviewEnabled: true,
  labels: [],
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  ...overrides,
});

describe("odt task workflow use cases", () => {
  test("ReadTaskUseCase returns the latest task summary and document presence", async () => {
    const issue = makeIssue({ status: "spec_ready" });
    const task = makeTask({ status: "spec_ready" });
    const calls: string[] = [];

    const useCase = new ReadTaskUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task };
        },
      },
      documentStore: {
        summarize: (rawIssue) => {
          calls.push(`docs:${rawIssue.id}`);
          return {
            qaVerdict: "not_reviewed",
            documents: {
              hasSpec: true,
              hasPlan: true,
              hasQaReport: false,
            },
          };
        },
      },
    });

    await expect(useCase.execute({ taskId: "task-1" })).resolves.toEqual({
      task: {
        ...makePublicTask({ status: "spec_ready" }),
        qaVerdict: "not_reviewed",
        documents: {
          hasSpec: true,
          hasPlan: true,
          hasQaReport: false,
        },
      },
    });
    expect(calls).toEqual(["init", "read:task-1", "docs:task-1"]);
  });

  test("ReadTaskDocumentsUseCase returns only requested persisted sections", async () => {
    const issue = makeIssue({ status: "spec_ready" });
    const task = makeTask({ status: "spec_ready" });
    const calls: string[] = [];

    const useCase = new ReadTaskDocumentsUseCase({
      workflow: {
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task };
        },
      },
      documentStore: {
        readDocuments: (rawIssue, input) => {
          calls.push(`docs:${rawIssue.id}:${String(input.includePlan)}`);
          return {
            documents: {
              implementationPlan: {
                markdown: "# Plan",
                updatedAt: null,
              },
            },
          };
        },
      },
    });

    await expect(useCase.execute({ taskId: "task-1", includePlan: true })).resolves.toEqual({
      documents: {
        implementationPlan: {
          markdown: "# Plan",
          updatedAt: null,
        },
      },
    });
    expect(calls).toEqual(["init", "read:task-1", "docs:task-1:true"]);
  });

  test("CreateTaskUseCase returns the public snapshot envelope", async () => {
    const issue = makeIssue({ issue_type: "bug" });
    const calls: string[] = [];

    const useCase = new CreateTaskUseCase({
      persistence: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        createTask: async (input) => {
          calls.push(`create:${input.issueType}:${input.priority}`);
          return issue;
        },
      },
      invalidateTaskIndex: () => {
        calls.push("invalidate");
      },
      documentStore: {
        summarize: () => ({
          qaVerdict: "not_reviewed",
          documents: {
            hasSpec: false,
            hasPlan: false,
            hasQaReport: false,
          },
        }),
      },
    });

    await expect(
      useCase.execute({ title: "Fix bug", issueType: "bug", priority: 1 }),
    ).resolves.toEqual({
      task: {
        ...makePublicTask({ issueType: "bug", priority: 2 }),
        qaVerdict: "not_reviewed",
        documents: {
          hasSpec: false,
          hasPlan: false,
          hasQaReport: false,
        },
      },
    });
    expect(calls).toEqual(["init", "create:bug:1", "invalidate"]);
  });

  test("SearchTasksUseCase returns active snapshots with limit metadata", async () => {
    const issueOne = makeIssue({ id: "task-1", title: "Task 1", status: "open" });
    const issueTwo = makeIssue({ id: "task-2", title: "Task 2", status: "human_review" });
    const issueClosed = makeIssue({ id: "task-3", title: "Task 3", status: "closed" });
    const calls: string[] = [];

    const useCase = new SearchTasksUseCase({
      persistence: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        listRawIssues: async () => {
          calls.push("list-raw");
          return [issueOne, issueTwo, issueClosed];
        },
      },
      documentStore: {
        summarize: () => ({
          qaVerdict: "not_reviewed",
          documents: {
            hasSpec: false,
            hasPlan: false,
            hasQaReport: false,
          },
        }),
      },
    });

    await expect(useCase.execute({ limit: 1 })).resolves.toEqual({
      results: [
        {
          task: {
            ...makePublicTask({ id: "task-1", title: "Task 1" }),
            qaVerdict: "not_reviewed",
            documents: {
              hasSpec: false,
              hasPlan: false,
              hasQaReport: false,
            },
          },
        },
      ],
      limit: 1,
      totalCount: 2,
      hasMore: true,
    });
    expect(calls).toEqual(["init", "list-raw"]);
  });

  test("SearchTasksUseCase surfaces invalid Beads statuses instead of hiding them", async () => {
    const calls: string[] = [];

    const useCase = new SearchTasksUseCase({
      persistence: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        listRawIssues: async () => {
          calls.push("list-raw");
          return [makeIssue({ id: "broken-task", status: { raw: "open" } })];
        },
      },
      documentStore: {
        summarize: () => ({
          qaVerdict: "not_reviewed",
          documents: {
            hasSpec: false,
            hasPlan: false,
            hasQaReport: false,
          },
        }),
      },
    });

    await expect(useCase.execute({ limit: 10 })).rejects.toThrow(
      'Invalid Beads status for task broken-task: received {"raw":"open"}.',
    );
    expect(calls).toEqual(["init", "list-raw"]);
  });

  test("SetSpecUseCase persists the document before transitioning open tasks", async () => {
    const initialTask = makeTask({ status: "open" });
    const transitionedTask = makeTask({ status: "spec_ready" });
    const transitionedIssue = makeIssue({ status: "spec_ready" });
    const calls: string[] = [];

    const useCase = new SetSpecUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        resolveTaskContext: async (taskId) => {
          calls.push(`resolve:${taskId}`);
          return { task: initialTask, tasks: [initialTask] };
        },
        refreshTaskContext: async (taskId, context) => {
          calls.push(`refresh:${taskId}:${context?.task.status ?? "none"}`);
          return { task: initialTask, tasks: [initialTask] };
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return {
            issue: transitionedIssue,
            task: transitionedTask,
          };
        },
      },
      documentStore: {
        persistSpec: async (taskId, markdown) => {
          calls.push(`persist:${taskId}:${markdown}`);
          return {
            issue: transitionedIssue,
            updatedAt: FIXED_TIMESTAMP,
            revision: 2,
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", markdown: "  # Refined spec  " }),
    ).resolves.toEqual({
      task: makePublicTask({ status: "spec_ready" }),
      document: {
        markdown: "# Refined spec",
        updatedAt: FIXED_TIMESTAMP,
        revision: 2,
      },
    });
    expect(calls).toEqual([
      "init",
      "resolve:task-1",
      "persist:task-1:# Refined spec",
      "refresh:task-1:open",
      "transition:task-1:spec_ready",
    ]);
  });

  test("SetPlanUseCase coordinates epic replacement through injected ports", async () => {
    const epicTask = makeTask({
      id: "epic-1",
      title: "Epic",
      status: "spec_ready",
      issueType: "epic",
    });
    const readyTask = makeTask({
      id: "epic-1",
      title: "Epic",
      status: "ready_for_dev",
      issueType: "epic",
    });
    const calls: string[] = [];

    const useCase = new SetPlanUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        resolveTaskContext: async (taskId) => {
          calls.push(`resolve:${taskId}`);
          return { task: epicTask, tasks: [epicTask] };
        },
        refreshTaskContext: async (taskId, context) => {
          calls.push(`refresh:${taskId}:${context?.task.status ?? "none"}`);
          return { task: epicTask, tasks: [epicTask] };
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return {
            issue: makeIssue({
              id: "epic-1",
              title: "Epic",
              status: "ready_for_dev",
              issue_type: "epic",
            }),
            task: readyTask,
          };
        },
      },
      documentStore: {
        persistImplementationPlan: async (taskId, markdown) => {
          calls.push(`persist:${taskId}:${markdown}`);
          return {
            issue: makeIssue({
              id: "epic-1",
              title: "Epic",
              status: "spec_ready",
              issue_type: "epic",
            }),
            updatedAt: "2026-03-02T00:00:00.000Z",
            revision: 4,
          };
        },
      },
      epicSubtaskReplacementService: {
        prepareReplacement: async (task, subtasks) => {
          calls.push(`prepare:${task.id}:${subtasks.length}`);
          return {
            latestTask: task,
            existingDirectSubtasks: [makeTask({ id: "sub-legacy", parentId: task.id })],
          };
        },
        applyReplacement: async (task, currentSubtasks, subtasks) => {
          calls.push(`apply:${task.id}:${currentSubtasks.length}:${subtasks.length}`);
          return ["epic-1-sub-1"];
        },
      },
    });

    await expect(
      useCase.execute({
        taskId: "epic-1",
        markdown: "  # Execution plan  ",
        subtasks: [{ title: "Build API" }],
      }),
    ).resolves.toEqual({
      task: makePublicTask({
        id: "epic-1",
        title: "Epic",
        status: "ready_for_dev",
        issueType: "epic",
      }),
      document: {
        markdown: "# Execution plan",
        updatedAt: "2026-03-02T00:00:00.000Z",
        revision: 4,
      },
      createdSubtaskIds: ["epic-1-sub-1"],
    });
    expect(calls).toEqual([
      "init",
      "resolve:epic-1",
      "prepare:epic-1:1",
      "persist:epic-1:# Execution plan",
      "apply:epic-1:1:1",
      "refresh:epic-1:spec_ready",
      "transition:epic-1:ready_for_dev",
    ]);
  });

  test("BuildCompletedUseCase routes to ai_review when AI review is enabled", async () => {
    const inProgressTask = makeTask({ status: "in_progress", aiReviewEnabled: true });
    const aiReviewTask = makeTask({ status: "ai_review", aiReviewEnabled: true });
    const issue = makeIssue();
    const calls: string[] = [];

    const useCase = new BuildCompletedUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task: inProgressTask };
        },
        resolveTaskContext: async (taskId) => {
          calls.push(`resolve:${taskId}`);
          return { task: inProgressTask, tasks: [inProgressTask] };
        },
        refreshTaskContext: async (taskId, context) => {
          calls.push(`refresh:${taskId}:${context?.task.status ?? "none"}`);
          return { task: inProgressTask, tasks: [inProgressTask] };
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return {
            issue: makeIssue({ status: "ai_review" }),
            task: aiReviewTask,
          };
        },
      },
      documentStore: {
        summarize: (rawIssue) => {
          calls.push(`docs:${rawIssue.id}:not_reviewed`);
          return {
            qaVerdict: "not_reviewed",
            documents: {
              hasSpec: false,
              hasPlan: false,
              hasQaReport: false,
            },
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", summary: "Implementation complete" }),
    ).resolves.toEqual({
      task: makePublicTask({ status: "ai_review" }),
      summary: "Implementation complete",
    });
    expect(calls).toEqual([
      "init",
      "resolve:task-1",
      "refresh:task-1:in_progress",
      "read:task-1",
      "docs:task-1:not_reviewed",
      "transition:task-1:ai_review",
    ]);
  });

  test("BuildBlockedUseCase returns the blocker reason and transitions to blocked", async () => {
    const calls: string[] = [];

    const useCase = new BuildBlockedUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return {
            issue: makeIssue({ status: "blocked" }),
            task: makeTask({ status: "blocked" }),
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reason: "Waiting on upstream change" }),
    ).resolves.toEqual({
      task: makePublicTask({ status: "blocked" }),
      reason: "Waiting on upstream change",
    });
    expect(calls).toEqual(["init", "transition:task-1:blocked"]);
  });

  test("BuildResumedUseCase transitions back to in_progress", async () => {
    const calls: string[] = [];

    const useCase = new BuildResumedUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        transitionTask: async (taskId, nextStatus) => {
          calls.push(`transition:${taskId}:${nextStatus}`);
          return {
            issue: makeIssue({ status: "in_progress" }),
            task: makeTask({ status: "in_progress" }),
          };
        },
      },
    });

    await expect(useCase.execute({ taskId: "task-1" })).resolves.toEqual({
      task: makePublicTask({ status: "in_progress" }),
    });
    expect(calls).toEqual(["init", "transition:task-1:in_progress"]);
  });

  test("SetPullRequestUseCase resolves canonical pull request metadata without changing ai_review status", async () => {
    const aiReviewTask = makeTask({ status: "ai_review" });
    const aiReviewIssue = makeIssue({ status: "ai_review" });
    const calls: string[] = [];
    let writeNamespacePayload: Record<string, unknown> | null = null;

    const useCase = new SetPullRequestUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue: aiReviewIssue, task: aiReviewTask };
        },
      },
      persistence: {
        getNamespaceData: (issue) => {
          calls.push(`namespace:${issue.id}`);
          return {
            root: {},
            namespace: {},
            documents: {},
          };
        },
        writeNamespace: async (_taskId, _root, namespace) => {
          calls.push("write");
          writeNamespacePayload = namespace as Record<string, unknown>;
        },
      },
      pullRequestResolver: {
        resolve: async ({ providerId, number }) => {
          calls.push(`resolve:${providerId}:${number}`);
          return {
            providerId,
            number,
            url: "https://github.com/openai/openducktor/pull/42",
            state: "open",
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
            lastSyncedAt: FIXED_TIMESTAMP,
          };
        },
      },
    });

    await expect(
      useCase.execute({
        taskId: "task-1",
        providerId: "github",
        number: 42,
      }),
    ).resolves.toEqual({
      task: makePublicTask({ status: "ai_review" }),
      pullRequest: {
        providerId: "github",
        number: 42,
        url: "https://github.com/openai/openducktor/pull/42",
        state: "open",
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        lastSyncedAt: FIXED_TIMESTAMP,
      },
    });
    expect(calls).toEqual([
      "init",
      "read:task-1",
      "resolve:github:42",
      "namespace:task-1",
      "write",
      "read:task-1",
    ]);
    expect(writeNamespacePayload).toEqual({
      pullRequest: {
        providerId: "github",
        number: 42,
        url: "https://github.com/openai/openducktor/pull/42",
        state: "open",
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        lastSyncedAt: FIXED_TIMESTAMP,
      },
    });
  });

  test("SetPullRequestUseCase persists canonical pull request metadata without transitioning human_review tasks", async () => {
    const humanReviewTask = makeTask({ status: "human_review" });
    const humanReviewIssue = makeIssue({ status: "human_review" });
    const calls: string[] = [];

    const useCase = new SetPullRequestUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue: humanReviewIssue, task: humanReviewTask };
        },
      },
      persistence: {
        getNamespaceData: (issue) => {
          calls.push(`namespace:${issue.id}`);
          return {
            root: {},
            namespace: {},
            documents: {},
          };
        },
        writeNamespace: async () => {
          calls.push("write");
        },
      },
      pullRequestResolver: {
        resolve: async ({ providerId, number }) => {
          calls.push(`resolve:${providerId}:${number}`);
          return {
            providerId,
            number,
            url: "https://github.com/openai/openducktor/pull/7",
            state: "draft",
            createdAt: FIXED_TIMESTAMP,
            updatedAt: FIXED_TIMESTAMP,
            lastSyncedAt: FIXED_TIMESTAMP,
          };
        },
      },
    });

    await expect(
      useCase.execute({
        taskId: "task-1",
        providerId: "github",
        number: 7,
      }),
    ).resolves.toEqual({
      task: makePublicTask({ status: "human_review" }),
      pullRequest: {
        providerId: "github",
        number: 7,
        url: "https://github.com/openai/openducktor/pull/7",
        state: "draft",
        createdAt: FIXED_TIMESTAMP,
        updatedAt: FIXED_TIMESTAMP,
        lastSyncedAt: FIXED_TIMESTAMP,
      },
    });
    expect(calls).toEqual([
      "init",
      "read:task-1",
      "resolve:github:7",
      "namespace:task-1",
      "write",
      "read:task-1",
    ]);
  });

  test("SetPullRequestUseCase rejects statuses outside the review flow", async () => {
    const useCase = new SetPullRequestUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {},
        readTaskSnapshot: async () => ({
          issue: makeIssue({ status: "spec_ready" }),
          task: makeTask({ status: "spec_ready" }),
        }),
      },
      persistence: {
        getNamespaceData: () => ({ root: {}, namespace: {}, documents: {} }),
        writeNamespace: async () => {
          throw new Error("write should not run");
        },
      },
      pullRequestResolver: {
        resolve: async () => {
          throw new Error("resolve should not run");
        },
      },
    });

    await expect(
      useCase.execute({
        taskId: "task-1",
        providerId: "github",
        number: 1,
      }),
    ).rejects.toThrow(
      "set_pull_request is only allowed from in_progress/ai_review/human_review (current: spec_ready)",
    );
  });

  test("QaApprovedUseCase writes the qa report and status in a single task update", async () => {
    const qaTask = makeTask({ status: "ai_review" });
    const issue = makeIssue({ status: "ai_review" });
    const calls: string[] = [];
    let appliedUpdate: { metadataRoot?: unknown; status?: string } | null = null;

    const useCase = new QaApprovedUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task: qaTask };
        },
        assertTransitionAllowed: () => {
          calls.push("assert");
        },
        applyTaskUpdate: async (taskId, input) => {
          calls.push(`apply:${taskId}:${input.status ?? "none"}`);
          appliedUpdate = input;
          return {
            issue: makeIssue({ status: "human_review" }),
            task: makeTask({ status: "human_review" }),
          };
        },
      },
      documentStore: {
        prepareQaReportWrite: (rawIssue, markdown, verdict) => {
          calls.push(`prepare:${rawIssue.id}:${verdict}:${markdown}`);
          return {
            metadataRoot: { openducktor: { documents: { qaReports: [{ verdict, markdown }] } } },
            namespace: {},
            root: {},
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA review" }),
    ).resolves.toEqual({ task: makePublicTask({ status: "human_review" }) });
    expect(calls).toEqual([
      "init",
      "read:task-1",
      "assert",
      "prepare:task-1:approved:## QA review",
      "apply:task-1:human_review",
    ]);
    expect(appliedUpdate).toEqual({
      metadataRoot: {
        openducktor: {
          documents: { qaReports: [{ verdict: "approved", markdown: "## QA review" }] },
        },
      },
      status: "human_review",
    });
  });

  test("QaRejectedUseCase accepts human_review tasks", async () => {
    const qaTask = makeTask({ status: "human_review" });
    const issue = makeIssue({ status: "human_review" });
    const calls: string[] = [];

    const useCase = new QaRejectedUseCase({
      workflow: {
        metadataNamespace: "openducktor",
        ensureInitialized: async () => {
          calls.push("init");
        },
        readTaskSnapshot: async (taskId) => {
          calls.push(`read:${taskId}`);
          return { issue, task: qaTask };
        },
        assertTransitionAllowed: () => {
          calls.push("assert");
        },
        applyTaskUpdate: async (taskId, input) => {
          calls.push(`apply:${taskId}:${input.status ?? "none"}`);
          return {
            issue: makeIssue({ status: "in_progress" }),
            task: makeTask({ status: "in_progress" }),
          };
        },
      },
      documentStore: {
        prepareQaReportWrite: (rawIssue, markdown, verdict) => {
          calls.push(`prepare:${rawIssue.id}:${verdict}:${markdown}`);
          return {
            metadataRoot: { openducktor: { documents: { qaReports: [{ verdict, markdown }] } } },
            namespace: {},
            root: {},
          };
        },
      },
    });

    await expect(
      useCase.execute({ taskId: "task-1", reportMarkdown: "## QA reject" }),
    ).resolves.toEqual({ task: makePublicTask({ status: "in_progress" }) });
    expect(calls).toEqual([
      "init",
      "read:task-1",
      "assert",
      "prepare:task-1:rejected:## QA reject",
      "apply:task-1:in_progress",
    ]);
  });
});
