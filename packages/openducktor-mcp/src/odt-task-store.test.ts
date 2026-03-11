import { describe, expect, test } from "bun:test";
import { OdtTaskStore } from "./odt-task-store";

type ProcessCall = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
};

type ProcessResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
};

type TestIssue = {
  id: string;
  title: string;
  status: string;
  issue_type: string;
  parent?: string;
  metadata?: unknown;
};

type HarnessOptions = {
  issues: TestIssue[];
  listSnapshots?: TestIssue[][];
  now?: () => string;
};

const FIXED_NOW = "2026-02-28T11:30:00.000Z";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const asRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
};

const makeIssue = (input: {
  id: string;
  title: string;
  status: string;
  issueType?: string;
  parentId?: string;
  metadata?: unknown;
}): TestIssue => {
  const issue: TestIssue = {
    id: input.id,
    title: input.title,
    status: input.status,
    issue_type: input.issueType ?? "task",
  };

  if (input.parentId) {
    issue.parent = input.parentId;
  }
  if (input.metadata !== undefined) {
    issue.metadata = input.metadata;
  }

  return issue;
};

class OdtStoreHarness {
  private readonly issues: Map<string, TestIssue>;
  private readonly listSnapshots: TestIssue[][] | null;
  private listCalls = 0;
  private createCounter = 0;
  private readonly now: () => string;
  readonly calls: ProcessCall[] = [];

  constructor(options: HarnessOptions) {
    this.issues = new Map(options.issues.map((issue) => [issue.id, clone(issue)]));
    this.listSnapshots = options.listSnapshots
      ? options.listSnapshots.map((row) => clone(row))
      : null;
    this.now = options.now ?? (() => FIXED_NOW);
  }

  createStore(): OdtTaskStore {
    return new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      {
        runProcess: (command, args, cwd, env) => this.runProcess(command, args, cwd, env),
        now: this.now,
      },
    );
  }

  getIssue(taskId: string): TestIssue {
    const issue = this.issues.get(taskId);
    if (!issue) {
      throw new Error(`Missing issue in harness: ${taskId}`);
    }
    return clone(issue);
  }

  getCommandCalls(command: string): ProcessCall[] {
    return this.calls.filter((call) => call.args[1] === command);
  }

  getStatusUpdateCalls(): ProcessCall[] {
    return this.calls.filter((call) => call.args[1] === "update" && call.args.includes("--status"));
  }

  getMetadataUpdateCalls(): ProcessCall[] {
    return this.calls.filter(
      (call) => call.args[1] === "update" && call.args.includes("--metadata"),
    );
  }

  private getListPayload(): TestIssue[] {
    if (!this.listSnapshots || this.listSnapshots.length === 0) {
      return [...this.issues.values()].map((issue) => clone(issue));
    }
    const snapshotIndex = Math.min(this.listCalls - 1, this.listSnapshots.length - 1);
    return clone(this.listSnapshots[snapshotIndex] ?? []);
  }

  private async runProcess(
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
  ): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    this.calls.push({
      command,
      args: [...args],
      cwd,
      env: { ...env },
    });

    const subcommand = args[1];
    let result: ProcessResult;

    switch (subcommand) {
      case "where":
        result = { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
        break;
      case "init":
        result = { ok: true, stdout: "" };
        break;
      case "config":
        result = { ok: true, stdout: "{}" };
        break;
      case "list":
        this.listCalls += 1;
        result = { ok: true, stdout: JSON.stringify(this.getListPayload()) };
        break;
      case "show": {
        const taskId = args[2] ?? "";
        const issue = this.issues.get(taskId);
        result = { ok: true, stdout: JSON.stringify(issue ? [clone(issue)] : []) };
        break;
      }
      case "create": {
        const titleIndex = args.indexOf("--title");
        const title =
          titleIndex >= 0 ? (args[titleIndex + 1] ?? "Untitled") : (args[2] ?? "Untitled");
        const typeIndex = args.indexOf("--type");
        const parentIndex = args.indexOf("--parent");
        const issueType = typeIndex >= 0 ? (args[typeIndex + 1] ?? "task") : "task";
        const parentId = parentIndex >= 0 ? args[parentIndex + 1] : undefined;

        this.createCounter += 1;
        const newId = `${parentId ?? "task"}-sub-${this.createCounter}`;
        const created = makeIssue({
          id: newId,
          title,
          status: "open",
          issueType,
          ...(parentId ? { parentId } : {}),
          metadata: {},
        });
        this.issues.set(newId, created);
        result = { ok: true, stdout: JSON.stringify({ id: newId }) };
        break;
      }
      case "delete": {
        const marker = args.indexOf("--");
        const taskId = marker >= 0 ? (args[marker + 1] ?? "") : "";
        const shouldCascade = args.includes("--cascade");
        this.issues.delete(taskId);
        if (shouldCascade) {
          for (const issue of [...this.issues.values()]) {
            if (issue.parent === taskId) {
              this.issues.delete(issue.id);
            }
          }
        }
        result = { ok: true, stdout: "{}" };
        break;
      }
      case "update": {
        const taskId = args[2] ?? "";
        const issue = this.issues.get(taskId);
        if (!issue) {
          result = { ok: true, stdout: "{}" };
          break;
        }

        if (args.includes("--status")) {
          const status = args[args.indexOf("--status") + 1];
          if (status) {
            issue.status = status;
          }
        }

        if (args.includes("--metadata")) {
          const metadataArg = args[args.indexOf("--metadata") + 1];
          issue.metadata = metadataArg ? JSON.parse(metadataArg) : {};
        }

        this.issues.set(taskId, issue);
        result = { ok: true, stdout: "{}" };
        break;
      }
      default:
        throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    }

    return {
      ok: result.ok,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }
}

const getNamespaceDocuments = (issue: TestIssue): Record<string, unknown> => {
  const root = asRecord(issue.metadata);
  const namespace = asRecord(root.openducktor);
  return asRecord(namespace.documents);
};

describe("OdtTaskStore workflow mutation paths", () => {
  test("readTask refreshes cached index for ambiguous id and resolves with latest list snapshot", async () => {
    const canonicalIssue = makeIssue({
      id: "alpha-wsp",
      title: "Alpha workflow",
      status: "in_progress",
      issueType: "feature",
      metadata: {},
    });
    const harness = new OdtStoreHarness({
      issues: [canonicalIssue],
      listSnapshots: [
        [
          makeIssue({
            id: "alpha-wsp",
            title: "Alpha workflow",
            status: "open",
            issueType: "feature",
            metadata: {},
          }),
          makeIssue({
            id: "beta-wsp",
            title: "Beta workflow",
            status: "open",
            issueType: "feature",
            metadata: {},
          }),
        ],
        [canonicalIssue],
      ],
    });

    const store = harness.createStore();
    const result = (await store.readTask({ taskId: "wsp" })) as {
      task: { id: string; status: string };
    };

    expect(result.task).toEqual({
      id: "alpha-wsp",
      title: "Alpha workflow",
      status: "in_progress",
      issueType: "feature",
      aiReviewEnabled: true,
    });
    expect(harness.getCommandCalls("list")).toHaveLength(2);
  });

  test("setSpec invalidates task index so the next readTask rebuilds list cache", async () => {
    const harness = new OdtStoreHarness({
      issues: [
        makeIssue({
          id: "task-1",
          title: "Task 1",
          status: "open",
          issueType: "feature",
          metadata: {},
        }),
      ],
    });
    const store = harness.createStore();

    await store.readTask({ taskId: "task-1" });
    expect(harness.getCommandCalls("list")).toHaveLength(1);

    const specResult = (await store.setSpec({
      taskId: "task-1",
      markdown: "  # Spec  ",
    })) as {
      task: { status: string };
      document: { markdown: string; revision: number };
    };

    expect(specResult.task.status).toBe("spec_ready");
    expect(specResult.document).toEqual({
      markdown: "# Spec",
      updatedAt: FIXED_NOW,
      revision: 1,
    });
    expect(harness.getCommandCalls("list")).toHaveLength(2);

    await store.readTask({ taskId: "task-1" });
    expect(harness.getCommandCalls("list")).toHaveLength(3);
  });

  test("setSpec writes latest-only spec document and preserves unrelated metadata", async () => {
    const initialMetadata = {
      rootFlag: true,
      openducktor: {
        qaRequired: false,
        custom: { owner: "team-a" },
        documents: {
          spec: [
            {
              markdown: "# Older spec",
              updatedAt: "2026-02-20T00:00:00.000Z",
              updatedBy: "spec-agent",
              sourceTool: "odt_set_spec",
              revision: 1,
            },
            {
              markdown: "# Previous spec",
              updatedAt: "2026-02-21T00:00:00.000Z",
              updatedBy: "spec-agent",
              sourceTool: "odt_set_spec",
              revision: 2,
            },
          ],
          implementationPlan: [
            {
              markdown: "# Existing plan",
              updatedAt: "2026-02-22T00:00:00.000Z",
              updatedBy: "planner-agent",
              sourceTool: "odt_set_plan",
              revision: 3,
            },
          ],
        },
      },
      external: { keep: "value" },
    };

    const harness = new OdtStoreHarness({
      issues: [
        makeIssue({
          id: "task-1",
          title: "Task 1",
          status: "spec_ready",
          issueType: "feature",
          metadata: initialMetadata,
        }),
      ],
    });
    const store = harness.createStore();

    const result = (await store.setSpec({
      taskId: "task-1",
      markdown: "  # Refined spec  ",
    })) as {
      task: { status: string };
      document: { markdown: string; revision: number };
    };

    expect(result.task.status).toBe("spec_ready");
    expect(result.document.revision).toBe(3);
    expect(harness.getStatusUpdateCalls()).toHaveLength(0);

    const updatedIssue = harness.getIssue("task-1");
    const metadata = asRecord(updatedIssue.metadata);
    const namespace = asRecord(metadata.openducktor);
    const documents = asRecord(namespace.documents);
    const spec = Array.isArray(documents.spec) ? documents.spec : [];
    const implementationPlan = Array.isArray(documents.implementationPlan)
      ? documents.implementationPlan
      : [];

    expect(spec).toEqual([
      {
        markdown: "# Refined spec",
        updatedAt: FIXED_NOW,
        updatedBy: "spec-agent",
        sourceTool: "odt_set_spec",
        revision: 3,
      },
    ]);
    expect(implementationPlan).toEqual(initialMetadata.openducktor.documents.implementationPlan);
    expect(metadata.rootFlag).toBe(true);
    expect(metadata.external).toEqual({ keep: "value" });
    expect(namespace.qaRequired).toBe(false);
    expect(namespace.custom).toEqual({ owner: "team-a" });
  });

  test("setPlan blocks epic replacement when refreshed subtasks contain active work", async () => {
    const harness = new OdtStoreHarness({
      issues: [
        makeIssue({
          id: "epic-1",
          title: "Epic task",
          status: "spec_ready",
          issueType: "epic",
          metadata: {},
        }),
      ],
      listSnapshots: [
        [
          makeIssue({
            id: "epic-1",
            title: "Epic task",
            status: "spec_ready",
            issueType: "epic",
            metadata: {},
          }),
        ],
        [
          makeIssue({
            id: "epic-1",
            title: "Epic task",
            status: "spec_ready",
            issueType: "epic",
            metadata: {},
          }),
          makeIssue({
            id: "legacy-subtask",
            title: "Legacy active subtask",
            status: "in_progress",
            issueType: "task",
            parentId: "epic-1",
            metadata: {},
          }),
        ],
      ],
    });
    const store = harness.createStore();

    await expect(
      store.setPlan({
        taskId: "epic-1",
        markdown: "# Plan",
        subtasks: [{ title: "New child" }],
      }),
    ).rejects.toThrow("Cannot replace epic subtasks while active work exists");

    expect(harness.getCommandCalls("list")).toHaveLength(2);
    expect(harness.getCommandCalls("delete")).toHaveLength(0);
    expect(harness.getCommandCalls("create")).toHaveLength(0);
    expect(harness.getStatusUpdateCalls()).toHaveLength(0);
    expect(harness.getMetadataUpdateCalls()).toHaveLength(0);
  });

  test("setPlan epic rules use fresh snapshot when context is stale", async () => {
    const harness = new OdtStoreHarness({
      issues: [
        makeIssue({
          id: "epic-1",
          title: "Epic task",
          status: "spec_ready",
          issueType: "epic",
          metadata: {},
        }),
      ],
      listSnapshots: [
        [
          makeIssue({
            id: "epic-1",
            title: "Epic task",
            status: "spec_ready",
            issueType: "epic",
            metadata: {},
          }),
        ],
        [
          makeIssue({
            id: "epic-1",
            title: "Epic task",
            status: "spec_ready",
            issueType: "epic",
            metadata: {},
          }),
          makeIssue({
            id: "legacy-subtask",
            title: "Legacy subtask",
            status: "open",
            issueType: "task",
            parentId: "epic-1",
            metadata: {},
          }),
        ],
      ],
    });
    const store = harness.createStore();

    const result = (await store.setPlan({
      taskId: "epic-1",
      markdown: "# Plan without proposed subtasks",
    })) as {
      task: { status: string };
      createdSubtaskIds: string[];
    };

    expect(result.task.status).toBe("ready_for_dev");
    expect(result.createdSubtaskIds).toEqual([]);
    expect(harness.getCommandCalls("list")).toHaveLength(2);
    expect(harness.getCommandCalls("delete")).toHaveLength(1);
    expect(harness.getCommandCalls("create")).toHaveLength(0);
    expect(harness.getMetadataUpdateCalls()).toHaveLength(1);
  });

  test("setPlan replaces epic subtasks, deduplicates by title key, and stores latest-only plan", async () => {
    const harness = new OdtStoreHarness({
      issues: [
        makeIssue({
          id: "epic-1",
          title: "Epic task",
          status: "spec_ready",
          issueType: "epic",
          metadata: {
            openducktor: {
              documents: {
                implementationPlan: [
                  {
                    markdown: "# Previous plan",
                    updatedAt: "2026-02-20T00:00:00.000Z",
                    updatedBy: "planner-agent",
                    sourceTool: "odt_set_plan",
                    revision: 1,
                  },
                ],
              },
            },
          },
        }),
        makeIssue({
          id: "legacy-subtask-a",
          title: "Legacy A",
          status: "open",
          issueType: "task",
          parentId: "epic-1",
          metadata: {},
        }),
        makeIssue({
          id: "legacy-subtask-b",
          title: "Legacy B",
          status: "open",
          issueType: "task",
          parentId: "epic-1",
          metadata: {},
        }),
      ],
    });
    const store = harness.createStore();

    const result = (await store.setPlan({
      taskId: "epic-1",
      markdown: "  # New execution plan  ",
      subtasks: [{ title: "Build API" }, { title: "build api" }, { title: "Write tests" }],
    })) as {
      task: { status: string };
      document: { revision: number; markdown: string };
      createdSubtaskIds: string[];
    };

    expect(result.task.status).toBe("ready_for_dev");
    expect(result.document).toEqual({
      markdown: "# New execution plan",
      updatedAt: FIXED_NOW,
      revision: 2,
    });
    expect(result.createdSubtaskIds).toEqual(["epic-1-sub-1", "epic-1-sub-2"]);
    expect(harness.getCommandCalls("delete")).toHaveLength(2);
    expect(harness.getCommandCalls("create")).toHaveLength(2);
    for (const createCall of harness.getCommandCalls("create")) {
      expect(createCall.args).toContain("--title");
    }
    expect(harness.getStatusUpdateCalls()).toHaveLength(1);
    expect(harness.getStatusUpdateCalls()[0]?.args).toContain("ready_for_dev");
    const metadataUpdateIndex = harness.calls.findIndex(
      (call) => call.args[1] === "update" && call.args.includes("--metadata"),
    );
    const firstDeleteIndex = harness.calls.findIndex((call) => call.args[1] === "delete");
    const firstCreateIndex = harness.calls.findIndex((call) => call.args[1] === "create");
    expect(metadataUpdateIndex).toBeGreaterThanOrEqual(0);
    expect(firstDeleteIndex).toBeGreaterThan(metadataUpdateIndex);
    expect(firstCreateIndex).toBeGreaterThan(metadataUpdateIndex);

    const documents = getNamespaceDocuments(harness.getIssue("epic-1"));
    const implementationPlan = Array.isArray(documents.implementationPlan)
      ? documents.implementationPlan
      : [];
    expect(implementationPlan).toEqual([
      {
        markdown: "# New execution plan",
        updatedAt: FIXED_NOW,
        updatedBy: "planner-agent",
        sourceTool: "odt_set_plan",
        revision: 2,
      },
    ]);
  });

  test("buildCompleted routes to human_review when ai review is disabled", async () => {
    const harness = new OdtStoreHarness({
      issues: [
        makeIssue({
          id: "task-1",
          title: "Build task",
          status: "in_progress",
          issueType: "feature",
          metadata: {
            openducktor: {
              qaRequired: false,
            },
          },
        }),
      ],
    });
    const store = harness.createStore();

    const result = (await store.buildCompleted({
      taskId: "task-1",
      summary: "Done",
    })) as {
      task: { status: string };
      summary: string;
    };

    expect(result.task.status).toBe("human_review");
    expect(result.summary).toBe("Done");
    expect(harness.getStatusUpdateCalls()).toHaveLength(1);
    expect(harness.getStatusUpdateCalls()[0]?.args).toContain("human_review");
  });

  test("qaRejected appends qa report entries and increments revision", async () => {
    const harness = new OdtStoreHarness({
      issues: [
        makeIssue({
          id: "task-1",
          title: "QA task",
          status: "ai_review",
          issueType: "feature",
          metadata: {
            openducktor: {
              documents: {
                qaReports: [
                  {
                    markdown: "Initial QA report",
                    verdict: "approved",
                    updatedAt: "2026-02-20T00:00:00.000Z",
                    updatedBy: "qa-agent",
                    sourceTool: "odt_qa_approved",
                    revision: 1,
                  },
                  {
                    markdown: "Invalid entry missing required fields",
                  },
                ],
              },
            },
          },
        }),
      ],
    });
    const store = harness.createStore();

    const result = (await store.qaRejected({
      taskId: "task-1",
      reportMarkdown: "  ## Needs fixes  ",
    })) as {
      task: { status: string };
    };

    expect(result.task.status).toBe("in_progress");
    expect(harness.getMetadataUpdateCalls()).toHaveLength(1);
    expect(harness.getStatusUpdateCalls()).toHaveLength(1);

    const documents = getNamespaceDocuments(harness.getIssue("task-1"));
    const qaReports = Array.isArray(documents.qaReports) ? documents.qaReports : [];
    expect(qaReports).toEqual([
      {
        markdown: "Initial QA report",
        verdict: "approved",
        updatedAt: "2026-02-20T00:00:00.000Z",
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_approved",
        revision: 1,
      },
      {
        markdown: "## Needs fixes",
        verdict: "rejected",
        updatedAt: FIXED_NOW,
        updatedBy: "qa-agent",
        sourceTool: "odt_qa_rejected",
        revision: 2,
      },
    ]);
  });

  test("qaApproved rejects invalid transition before mutating metadata", async () => {
    const harness = new OdtStoreHarness({
      issues: [
        makeIssue({
          id: "task-1",
          title: "QA task",
          status: "open",
          issueType: "feature",
          metadata: {},
        }),
      ],
    });
    const store = harness.createStore();

    await expect(
      store.qaApproved({
        taskId: "task-1",
        reportMarkdown: "## QA report",
      }),
    ).rejects.toThrow("QA outcomes are only allowed from ai_review or human_review");

    expect(harness.getMetadataUpdateCalls()).toHaveLength(0);
    expect(harness.getStatusUpdateCalls()).toHaveLength(0);
  });
});
