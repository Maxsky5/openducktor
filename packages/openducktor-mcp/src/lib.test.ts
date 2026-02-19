import { describe, expect, test } from "bun:test";
import { ODT_TOOL_SCHEMAS, computeRepoId, normalizePlanSubtasks, resolveStoreContext } from "./lib";

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

  test("resolves context with default metadata namespace", async () => {
    const previousRepo = process.env.ODT_REPO_PATH;
    const previousNamespace = process.env.ODT_METADATA_NAMESPACE;
    const previousBeads = process.env.ODT_BEADS_DIR;

    try {
      process.env.ODT_REPO_PATH = "/tmp/openducktor-repo";
      process.env.ODT_METADATA_NAMESPACE = undefined;
      process.env.ODT_BEADS_DIR = undefined;

      const resolved = await resolveStoreContext({});
      expect(resolved.repoPath.length).toBeGreaterThan(0);
      expect(resolved.metadataNamespace).toBe("openducktor");
      expect(resolved.beadsDir).toBeUndefined();
    } finally {
      if (previousRepo === undefined) {
        process.env.ODT_REPO_PATH = undefined;
      } else {
        process.env.ODT_REPO_PATH = previousRepo;
      }
      if (previousNamespace === undefined) {
        process.env.ODT_METADATA_NAMESPACE = undefined;
      } else {
        process.env.ODT_METADATA_NAMESPACE = previousNamespace;
      }
      if (previousBeads === undefined) {
        process.env.ODT_BEADS_DIR = undefined;
      } else {
        process.env.ODT_BEADS_DIR = previousBeads;
      }
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
});
