import { afterEach, describe, expect, test } from "bun:test";
import {
  ODT_TOOL_SCHEMAS,
  OdtTaskStore,
  computeRepoId,
  normalizePlanSubtasks,
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

  test("OdtTaskStore initialization is cached across concurrent calls", async () => {
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
    expect(calls.filter((entry) => entry.args[1] === "show")).toHaveLength(3);
    for (const call of calls) {
      expect(call.command).toBe("bd");
      expect(call.env.BEADS_DIR).toBe("/beads");
    }
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

    const namespace = ((metadataPayload as Record<string, unknown>)?.openducktor ?? {}) as Record<
      string,
      unknown
    >;
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
});
