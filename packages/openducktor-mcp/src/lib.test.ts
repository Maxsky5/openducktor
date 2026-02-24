import { afterEach, describe, expect, test } from "bun:test";
import {
  computeRepoId,
  normalizePlanSubtasks,
  ODT_TOOL_SCHEMAS,
  OdtTaskStore,
  resolveStoreContext,
} from "./lib";

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

const ENV_KEYS = ["ODT_REPO_PATH", "ODT_METADATA_NAMESPACE", "ODT_BEADS_DIR", "BEADS_DIR"] as const;

const takeEnvSnapshot = (): Record<(typeof ENV_KEYS)[number], string | undefined> => ({
  ODT_REPO_PATH: process.env.ODT_REPO_PATH,
  ODT_METADATA_NAMESPACE: process.env.ODT_METADATA_NAMESPACE,
  ODT_BEADS_DIR: process.env.ODT_BEADS_DIR,
  BEADS_DIR: process.env.BEADS_DIR,
});

const restoreEnvSnapshot = (
  snapshot: Record<(typeof ENV_KEYS)[number], string | undefined>,
): void => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
      continue;
    }
    process.env[key] = value;
  }
};

const buildProcessRunner = (
  impl: (args: string[]) => ProcessResult,
): {
  runProcess: (
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
  ) => Promise<{ ok: boolean; stdout: string; stderr: string }>;
  calls: ProcessCall[];
} => {
  const calls: ProcessCall[] = [];

  return {
    runProcess: async (command, args, cwd, env) => {
      calls.push({
        command,
        args: [...args],
        cwd,
        env: { ...env },
      });
      const result = impl(args);
      return {
        ok: result.ok,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };
    },
    calls,
  };
};

afterEach(() => {
  restoreEnvSnapshot({
    ODT_REPO_PATH: undefined,
    ODT_METADATA_NAMESPACE: undefined,
    ODT_BEADS_DIR: undefined,
    BEADS_DIR: undefined,
  });
});

describe("openducktor-mcp lib", () => {
  test("normalizes and clamps plan subtasks", () => {
    const normalized = normalizePlanSubtasks([
      {
        title: "  Implement auth endpoint  ",
        issueType: "feature",
        priority: 99,
        description: "  add provider callbacks  ",
      },
    ]);

    expect(normalized).toEqual([
      {
        title: "Implement auth endpoint",
        issueType: "feature",
        priority: 4,
        description: "add provider callbacks",
      },
    ]);
  });

  test("rejects invalid subtask title and epic subtype", () => {
    expect(() => normalizePlanSubtasks([{ title: "   ", issueType: "task" }])).toThrow(
      "non-empty title",
    );
    expect(() =>
      normalizePlanSubtasks([
        { title: "Illegal", issueType: "epic" as "task" | "feature" | "bug" },
      ]),
    ).toThrow("Epic subtasks are not allowed");
  });

  test("resolveStoreContext prefers explicit context over environment", async () => {
    const snapshot = takeEnvSnapshot();
    try {
      process.env.ODT_REPO_PATH = "/tmp/env-repo";
      process.env.ODT_METADATA_NAMESPACE = "env-ns";
      process.env.ODT_BEADS_DIR = "/tmp/env-beads";
      process.env.BEADS_DIR = "/tmp/fallback-beads";

      const resolved = await resolveStoreContext({
        repoPath: "/tmp/context-repo",
        metadataNamespace: "context-ns",
        beadsDir: "/tmp/context-beads",
      });

      expect(resolved.repoPath).toBe("/tmp/context-repo");
      expect(resolved.metadataNamespace).toBe("context-ns");
      expect(resolved.beadsDir).toBe("/tmp/context-beads");
    } finally {
      restoreEnvSnapshot(snapshot);
    }
  });

  test("resolveStoreContext treats empty/sentinel env values as missing", async () => {
    const snapshot = takeEnvSnapshot();
    try {
      process.env.ODT_REPO_PATH = "undefined";
      process.env.ODT_METADATA_NAMESPACE = "null";
      process.env.ODT_BEADS_DIR = "  ";
      process.env.BEADS_DIR = "/tmp/fallback-beads";

      const resolved = await resolveStoreContext({});
      expect(resolved.repoPath.length).toBeGreaterThan(0);
      expect(resolved.metadataNamespace).toBe("openducktor");
      expect(resolved.beadsDir).toBe("/tmp/fallback-beads");
    } finally {
      restoreEnvSnapshot(snapshot);
    }
  });

  test("computes stable repo id with slug and hash", async () => {
    const id = await computeRepoId("/tmp/OpenDucktor Repo");
    expect(id).toMatch(/^openducktor-repo-[a-f0-9]{8}$/);
  });

  test("schema validates odt_set_spec required fields", () => {
    const parsed = ODT_TOOL_SCHEMAS.odt_set_spec.parse({
      taskId: "task-1",
      markdown: "# Spec",
    });
    expect(parsed.taskId).toBe("task-1");
    expect(parsed.markdown).toBe("# Spec");
    expect(() =>
      ODT_TOOL_SCHEMAS.odt_set_spec.parse({
        taskId: "task-1",
      }),
    ).toThrow();
  });

  test("setSpec resolves unique slug-like task identifier to canonical task id", async () => {
    let metadataTargetTaskId: string | null = null;
    let statusTargetTaskId: string | null = null;
    let status = "open";

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "fairnest-wsp",
              title: "Add Facebook OAuth Login",
              status,
              issue_type: "epic",
              metadata: {},
            },
            {
              id: "fairnest-abc",
              title: "Improve UI spacing",
              status: "open",
              issue_type: "task",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        const id = args[2];
        if (id !== "fairnest-wsp") {
          return { ok: true, stdout: JSON.stringify([]) };
        }
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "fairnest-wsp",
              title: "Add Facebook OAuth Login",
              status,
              issue_type: "epic",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        metadataTargetTaskId = args[2] ?? null;
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusTargetTaskId = args[2] ?? null;
        status = args[args.indexOf("--status") + 1] ?? status;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      {
        runProcess,
        now: () => "2026-02-19T12:00:00.000Z",
      },
    );

    const result = (await store.setSpec({
      taskId: "facebook-oauth",
      markdown: "# Spec",
    })) as { task: { id: string; status: string } };

    expect(result.task.id).toBe("fairnest-wsp");
    expect(result.task.status).toBe("spec_ready");
    expect(metadataTargetTaskId).toBe("fairnest-wsp");
    expect(statusTargetTaskId).toBe("fairnest-wsp");
  });

  test("setSpec resolves short task id suffix to canonical task id", async () => {
    let metadataTargetTaskId: string | null = null;
    let statusTargetTaskId: string | null = null;
    let status = "open";

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "fairnest-wsp",
              title: "Add Facebook OAuth Login",
              status,
              issue_type: "epic",
              metadata: {},
            },
            {
              id: "fairnest-abc",
              title: "Improve UI spacing",
              status: "open",
              issue_type: "task",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        const id = args[2];
        if (id !== "fairnest-wsp") {
          return { ok: true, stdout: JSON.stringify([]) };
        }
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "fairnest-wsp",
              title: "Add Facebook OAuth Login",
              status,
              issue_type: "epic",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        metadataTargetTaskId = args[2] ?? null;
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusTargetTaskId = args[2] ?? null;
        status = args[args.indexOf("--status") + 1] ?? status;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      {
        runProcess,
        now: () => "2026-02-19T12:00:00.000Z",
      },
    );

    const result = (await store.setSpec({
      taskId: "wsp",
      markdown: "# Spec",
    })) as { task: { id: string; status: string } };

    expect(result.task.id).toBe("fairnest-wsp");
    expect(result.task.status).toBe("spec_ready");
    expect(metadataTargetTaskId).toBe("fairnest-wsp");
    expect(statusTargetTaskId).toBe("fairnest-wsp");
  });

  test("setSpec fails with explicit candidates when task identifier is ambiguous", async () => {
    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "fairnest-a1",
              title: "Add Facebook OAuth Login",
              status: "open",
              issue_type: "epic",
              metadata: {},
            },
            {
              id: "fairnest-a2",
              title: "Harden Facebook OAuth callback",
              status: "open",
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.setSpec({
        taskId: "facebook-oauth",
        markdown: "# Spec",
      }),
    ).rejects.toThrow('Task identifier "facebook-oauth" is ambiguous');
  });

  test("OdtTaskStore initialization and task index build are cached across concurrent calls", async () => {
    const { runProcess, calls } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: false, stdout: "", stderr: "not initialized" };
      }
      if (command === "init") {
        return { ok: true, stdout: "" };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status: "open",
              issue_type: "task",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status: "open",
              issue_type: "task",
              metadata: {},
            },
          ]),
        };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await Promise.all([
      store.readTask({ taskId: "task-1" }),
      store.readTask({ taskId: "task-1" }),
      store.readTask({ taskId: "task-1" }),
    ]);

    expect(calls.filter((entry) => entry.args[1] === "init")).toHaveLength(1);
    expect(calls.filter((entry) => entry.args[1] === "config")).toHaveLength(1);
    expect(calls.filter((entry) => entry.args[1] === "list")).toHaveLength(1);
    expect(calls.filter((entry) => entry.args[1] === "show")).toHaveLength(3);
    for (const call of calls) {
      expect(call.command).toBe("bd");
      expect(call.env.BEADS_DIR).toBe("/beads");
    }
  });

  test("readTask refreshes index on not-found cache miss and resolves newly added task", async () => {
    let listCalls = 0;

    const { runProcess, calls } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        const issues =
          listCalls === 1
            ? [
                {
                  id: "task-1",
                  title: "Task 1",
                  status: "open",
                  issue_type: "task",
                  metadata: {},
                },
              ]
            : [
                {
                  id: "task-1",
                  title: "Task 1",
                  status: "open",
                  issue_type: "task",
                  metadata: {},
                },
                {
                  id: "task-2",
                  title: "Task 2",
                  status: "in_progress",
                  issue_type: "task",
                  metadata: {},
                },
              ];

        return {
          ok: true,
          stdout: JSON.stringify(issues),
        };
      }
      if (command === "show") {
        const id = args[2];
        if (id !== "task-1" && id !== "task-2") {
          return { ok: true, stdout: JSON.stringify([]) };
        }

        const issue = {
          id,
          title: id === "task-2" ? "Task 2" : "Task 1",
          status: id === "task-2" ? "in_progress" : "open",
          issue_type: "task",
          metadata: {},
        };

        return {
          ok: true,
          stdout: JSON.stringify([issue]),
        };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await store.readTask({ taskId: "task-1" });
    const result = (await store.readTask({ taskId: "task-2" })) as {
      task: { id: string; status: string };
    };

    expect(result.task.id).toBe("task-2");
    expect(result.task.status).toBe("in_progress");
    expect(calls.filter((entry) => entry.args[1] === "list")).toHaveLength(2);
  });

  test("readTask refreshes index on ambiguous cache miss and resolves uniquely", async () => {
    let listCalls = 0;

    const { runProcess, calls } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        const issues =
          listCalls === 1
            ? [
                {
                  id: "fairnest-wsp",
                  title: "Task A",
                  status: "open",
                  issue_type: "task",
                  metadata: {},
                },
                {
                  id: "delta-wsp",
                  title: "Task B",
                  status: "open",
                  issue_type: "task",
                  metadata: {},
                },
              ]
            : [
                {
                  id: "fairnest-wsp",
                  title: "Task A",
                  status: "in_progress",
                  issue_type: "task",
                  metadata: {},
                },
              ];

        return { ok: true, stdout: JSON.stringify(issues) };
      }
      if (command === "show") {
        const id = args[2];
        if (id !== "fairnest-wsp") {
          return { ok: true, stdout: JSON.stringify([]) };
        }

        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "fairnest-wsp",
              title: "Task A",
              status: "in_progress",
              issue_type: "task",
              metadata: {},
            },
          ]),
        };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    const result = (await store.readTask({ taskId: "wsp" })) as {
      task: { id: string; status: string };
    };

    expect(result.task.id).toBe("fairnest-wsp");
    expect(result.task.status).toBe("in_progress");
    expect(calls.filter((entry) => entry.args[1] === "list")).toHaveLength(2);
  });

  test("buildResumed allows task issues to skip spec/planning from open", async () => {
    let status = "open";
    let statusTransition: string | null = null;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "task",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "task",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--status")) {
        status = args[args.indexOf("--status") + 1] ?? status;
        statusTransition = status;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    const result = (await store.buildResumed({
      taskId: "task-1",
    })) as { task: { status: string } };

    expect(result.task.status).toBe("in_progress");
    expect(statusTransition).toBe("in_progress");
  });

  test("buildResumed rejects feature issues from open and does not update status", async () => {
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status: "open",
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.buildResumed({
        taskId: "task-1",
      }),
    ).rejects.toThrow("Transition not allowed");

    expect(statusUpdateCalls).toBe(0);
  });

  test("qaApproved fails fast when transition is not allowed and does not write metadata", async () => {
    let metadataUpdateCalls = 0;
    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status: "open",
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        metadataUpdateCalls += 1;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.qaApproved({
        taskId: "task-1",
        reportMarkdown: "## QA",
      }),
    ).rejects.toThrow("Transition not allowed");

    expect(metadataUpdateCalls).toBe(0);
  });

  test("qaApproved appends qa report metadata and transitions to human_review", async () => {
    let metadataPayload: Record<string, unknown> | null = null;
    let statusTransition: string | null = null;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status: "ai_review",
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status: statusTransition === "human_review" ? "human_review" : "ai_review",
              issue_type: "feature",
              metadata: metadataPayload ?? {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        const metadataArg = args[args.indexOf("--metadata") + 1];
        metadataPayload = JSON.parse(metadataArg ?? "{}") as Record<string, unknown>;
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusTransition = args[args.indexOf("--status") + 1] ?? null;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      {
        runProcess,
        now: () => "2026-02-19T12:00:00.000Z",
      },
    );

    const result = (await store.qaApproved({
      taskId: "task-1",
      reportMarkdown: "## QA report",
    })) as { task: { status: string } };

    expect(result.task.status).toBe("human_review");
    expect(statusTransition).toBe("human_review");

    const metadataRoot = (metadataPayload ?? {}) as Record<string, unknown>;
    const namespaceValue = metadataRoot.openducktor;
    const namespace =
      typeof namespaceValue === "object" && namespaceValue !== null
        ? (namespaceValue as Record<string, unknown>)
        : {};
    const documents = (namespace.documents ?? {}) as Record<string, unknown>;
    const qaReports = (documents.qaReports ?? []) as Array<Record<string, unknown>>;
    expect(qaReports).toHaveLength(1);
    expect(qaReports[0]).toMatchObject({
      markdown: "## QA report",
      verdict: "approved",
      sourceTool: "odt_qa_approved",
      updatedBy: "qa-agent",
      revision: 1,
      updatedAt: "2026-02-19T12:00:00.000Z",
    });
  });

  test("setSpec revalidates transition after metadata write and avoids stale status updates", async () => {
    let status = "open";
    let listCalls = 0;
    let metadataUpdateCalls = 0;
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        metadataUpdateCalls += 1;
        status = "in_progress";
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.setSpec({
        taskId: "task-1",
        markdown: "# Spec",
      }),
    ).rejects.toThrow("Transition not allowed");

    expect(listCalls).toBe(1);
    expect(metadataUpdateCalls).toBe(1);
    expect(statusUpdateCalls).toBe(0);
  });

  test("setPlan revalidates transition after side effects and avoids stale status updates", async () => {
    let status = "spec_ready";
    let listCalls = 0;
    let metadataUpdateCalls = 0;
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        metadataUpdateCalls += 1;
        status = "in_progress";
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.setPlan({
        taskId: "task-1",
        markdown: "# Plan",
      }),
    ).rejects.toThrow("Transition not allowed");

    expect(listCalls).toBe(1);
    expect(metadataUpdateCalls).toBe(1);
    expect(statusUpdateCalls).toBe(0);
  });

  test("setPlan epic subtasks revalidates against a fresh snapshot before replacement", async () => {
    let status = "spec_ready";
    let listCalls = 0;
    let createCalls = 0;
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Epic Task",
              status,
              issue_type: "epic",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Epic Task",
              status,
              issue_type: "epic",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "create") {
        createCalls += 1;
        return { ok: true, stdout: JSON.stringify({ id: "task-1-sub-1" }) };
      }
      if (command === "update" && args.includes("--metadata")) {
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        status = args[args.indexOf("--status") + 1] ?? status;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    const result = (await store.setPlan({
      taskId: "task-1",
      markdown: "# Plan",
      subtasks: [{ title: "Implement child task" }],
    })) as {
      task: { status: string };
      createdSubtaskIds: string[];
    };

    expect(result.task.status).toBe("ready_for_dev");
    expect(result.createdSubtaskIds).toEqual(["task-1-sub-1"]);
    expect(listCalls).toBe(2);
    expect(createCalls).toBe(1);
    expect(statusUpdateCalls).toBe(1);
  });

  test("setPlan allows feature tasks to update plan from ready_for_dev", async () => {
    let status = "ready_for_dev";
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Feature task",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Feature task",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        status = args[args.indexOf("--status") + 1] ?? status;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    const result = (await store.setPlan({
      taskId: "task-1",
      markdown: "# Updated plan",
    })) as {
      task: { status: string };
      document: { markdown: string };
    };

    expect(result.document.markdown).toBe("# Updated plan");
    expect(result.task.status).toBe("ready_for_dev");
    expect(statusUpdateCalls).toBe(0);
  });

  test("setPlan epic subtasks replace existing direct subtasks", async () => {
    let status = "spec_ready";
    const deletedTaskIds: string[] = [];
    let createCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "epic-1",
              title: "Epic task",
              status,
              issue_type: "epic",
              metadata: {},
            },
            {
              id: "legacy-subtask",
              title: "Legacy child",
              status: "open",
              issue_type: "task",
              parent: "epic-1",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "epic-1",
              title: "Epic task",
              status,
              issue_type: "epic",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        return { ok: true, stdout: "{}" };
      }
      if (command === "delete") {
        const taskIdArg = args[args.indexOf("--") + 1] ?? "";
        deletedTaskIds.push(taskIdArg);
        return { ok: true, stdout: "{}" };
      }
      if (command === "create") {
        createCalls += 1;
        return { ok: true, stdout: JSON.stringify({ id: `new-subtask-${createCalls}` }) };
      }
      if (command === "update" && args.includes("--status")) {
        status = args[args.indexOf("--status") + 1] ?? status;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    const result = (await store.setPlan({
      taskId: "epic-1",
      markdown: "# New epic plan",
      subtasks: [{ title: "New child task" }],
    })) as {
      createdSubtaskIds: string[];
      task: { status: string };
    };

    expect(deletedTaskIds).toEqual(["legacy-subtask"]);
    expect(createCalls).toBe(1);
    expect(result.createdSubtaskIds).toEqual(["new-subtask-1"]);
    expect(result.task.status).toBe("ready_for_dev");
  });

  test("setPlan epic omitting subtasks clears existing direct subtasks", async () => {
    let status = "spec_ready";
    const deletedTaskIds: string[] = [];
    let createCalls = 0;
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "epic-1",
              title: "Epic task",
              status,
              issue_type: "epic",
              metadata: {},
            },
            {
              id: "legacy-subtask",
              title: "Legacy child",
              status: "open",
              issue_type: "task",
              parent: "epic-1",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "epic-1",
              title: "Epic task",
              status,
              issue_type: "epic",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        return { ok: true, stdout: "{}" };
      }
      if (command === "delete") {
        const taskIdArg = args[args.indexOf("--") + 1] ?? "";
        deletedTaskIds.push(taskIdArg);
        return { ok: true, stdout: "{}" };
      }
      if (command === "create") {
        createCalls += 1;
        return { ok: true, stdout: JSON.stringify({ id: `new-subtask-${createCalls}` }) };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        status = args[args.indexOf("--status") + 1] ?? status;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    const result = (await store.setPlan({
      taskId: "epic-1",
      markdown: "# New epic plan",
    })) as {
      createdSubtaskIds: string[];
      task: { status: string };
    };

    expect(deletedTaskIds).toEqual(["legacy-subtask"]);
    expect(createCalls).toBe(0);
    expect(result.createdSubtaskIds).toEqual([]);
    expect(statusUpdateCalls).toBe(1);
    expect(result.task.status).toBe("ready_for_dev");
  });

  test("setPlan epic subtasks blocks replacement when refreshed subtasks are active", async () => {
    let status = "spec_ready";
    let listCalls = 0;
    let createCalls = 0;
    let statusUpdateCalls = 0;
    const deletedTaskIds: string[] = [];

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        const refreshedSubtaskStatus = listCalls >= 2 ? "in_progress" : "open";
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "epic-1",
              title: "Epic task",
              status,
              issue_type: "epic",
              metadata: {},
            },
            {
              id: "legacy-subtask",
              title: "Legacy child",
              status: refreshedSubtaskStatus,
              issue_type: "task",
              parent: "epic-1",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "epic-1",
              title: "Epic task",
              status,
              issue_type: "epic",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        return { ok: true, stdout: "{}" };
      }
      if (command === "delete") {
        const taskIdArg = args[args.indexOf("--") + 1] ?? "";
        deletedTaskIds.push(taskIdArg);
        return { ok: true, stdout: "{}" };
      }
      if (command === "create") {
        createCalls += 1;
        return { ok: true, stdout: JSON.stringify({ id: `new-subtask-${createCalls}` }) };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        status = args[args.indexOf("--status") + 1] ?? status;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.setPlan({
        taskId: "epic-1",
        markdown: "# New epic plan",
        subtasks: [{ title: "New child task" }],
      }),
    ).rejects.toThrow("Cannot replace epic subtasks while active work exists");

    expect(listCalls).toBe(2);
    expect(deletedTaskIds).toEqual([]);
    expect(createCalls).toBe(0);
    expect(statusUpdateCalls).toBe(0);
  });

  test("buildCompleted revalidates using refreshed task and avoids duplicate list calls", async () => {
    let status = "in_progress";
    let listCalls = 0;
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        const currentStatus = status;
        if (listCalls === 1) {
          status = "blocked";
        }
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status: currentStatus,
              issue_type: "feature",
              ai_review_enabled: false,
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        status = args[args.indexOf("--status") + 1] ?? status;
        return { ok: true, stdout: "{}" };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              ai_review_enabled: false,
              metadata: {},
            },
          ]),
        };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.buildCompleted({
        taskId: "task-1",
      }),
    ).rejects.toThrow("Transition not allowed");

    expect(listCalls).toBe(1);
    expect(statusUpdateCalls).toBe(0);
  });

  test("qaApproved revalidates transition after report append and avoids stale status updates", async () => {
    let status = "ai_review";
    let listCalls = 0;
    let metadataUpdateCalls = 0;
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        metadataUpdateCalls += 1;
        status = "closed";
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.qaApproved({
        taskId: "task-1",
        reportMarkdown: "## QA",
      }),
    ).rejects.toThrow("Transition not allowed");

    expect(listCalls).toBe(1);
    expect(metadataUpdateCalls).toBe(1);
    expect(statusUpdateCalls).toBe(0);
  });

  test("qaRejected revalidates transition after report append and avoids stale status updates", async () => {
    let status = "human_review";
    let listCalls = 0;
    let metadataUpdateCalls = 0;
    let statusUpdateCalls = 0;

    const { runProcess } = buildProcessRunner((args) => {
      const command = args[1];
      if (command === "where") {
        return { ok: true, stdout: JSON.stringify({ path: "/beads" }) };
      }
      if (command === "config") {
        return { ok: true, stdout: "{}" };
      }
      if (command === "list") {
        listCalls += 1;
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "show") {
        return {
          ok: true,
          stdout: JSON.stringify([
            {
              id: "task-1",
              title: "Task 1",
              status,
              issue_type: "feature",
              metadata: {},
            },
          ]),
        };
      }
      if (command === "update" && args.includes("--metadata")) {
        metadataUpdateCalls += 1;
        status = "closed";
        return { ok: true, stdout: "{}" };
      }
      if (command === "update" && args.includes("--status")) {
        statusUpdateCalls += 1;
        return { ok: true, stdout: "{}" };
      }
      throw new Error(`Unexpected bd command: ${args.join(" ")}`);
    });

    const store = new OdtTaskStore(
      {
        repoPath: "/repo",
        metadataNamespace: "openducktor",
        beadsDir: "/beads",
      },
      { runProcess },
    );

    await expect(
      store.qaRejected({
        taskId: "task-1",
        reportMarkdown: "## QA",
      }),
    ).rejects.toThrow("Transition not allowed");

    expect(listCalls).toBe(1);
    expect(metadataUpdateCalls).toBe(1);
    expect(statusUpdateCalls).toBe(0);
  });
});
