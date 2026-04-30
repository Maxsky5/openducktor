import { describe, expect, test } from "bun:test";
import { taskDocumentsReadSchema, taskMetadataPayloadSchema } from "./index";

describe("document contracts", () => {
  test("task metadata documents accept optional document-level decode errors", () => {
    const parsed = taskMetadataPayloadSchema.parse({
      spec: {
        markdown: "",
        updatedAt: "2026-02-20T09:00:00Z",
        error: "Failed to decode openducktor.documents.spec[0]: invalid base64 payload",
      },
      plan: {
        markdown: "# Plan",
        updatedAt: null,
      },
      targetBranch: {
        remote: "origin",
        branch: "release/2026.04",
      },
      qaReport: {
        markdown: "",
        verdict: "not_reviewed",
        updatedAt: null,
        revision: null,
        error: "Failed to decode openducktor.documents.qaReports[0]: invalid gzip payload",
      },
      agentSessions: [],
    });

    expect(parsed.spec.error).toContain("invalid base64 payload");
    expect(parsed.targetBranch).toEqual({ remote: "origin", branch: "release/2026.04" });
    expect(parsed.qaReport?.verdict).toBe("not_reviewed");
    expect(parsed.qaReport?.error).toContain("invalid gzip payload");
  });

  test("task metadata payload normalizes legacy delivery fields and validates canonical sessions", () => {
    const parsed = taskMetadataPayloadSchema.parse({
      spec: {
        markdown: "",
        updatedAt: null,
      },
      plan: {
        markdown: "",
        updatedAt: null,
      },
      delivery: {
        linkedPullRequest: {
          providerId: "github",
          number: 42,
          url: "https://github.com/openai/openducktor/pull/42",
          state: "open",
          createdAt: "2026-02-20T09:30:00Z",
          updatedAt: "2026-02-20T09:45:00Z",
        },
        directMerge: {
          method: "squash",
          sourceBranch: "task/openducktor-dpp",
          targetBranch: {
            remote: "origin",
            branch: "main",
          },
          mergedAt: "2026-02-20T10:00:00Z",
        },
      },
      agentSessions: [
        {
          sessionId: "session-1",
          role: "build",
          scenario: "build_implementation_start",
          startedAt: "2026-02-18T17:20:00Z",
          runtimeKind: "opencode",
          workingDirectory: "/repo",
        },
      ],
    });

    expect(parsed.pullRequest?.number).toBe(42);
    expect(parsed.directMerge?.method).toBe("squash");
    expect(parsed.agentSessions).toHaveLength(1);
    expect(parsed.agentSessions[0]).toEqual(
      expect.objectContaining({
        externalSessionId: "session-1",
        scenario: "build_implementation_start",
      }),
    );
    expect("sessionId" in (parsed.agentSessions[0] ?? {})).toBe(false);
  });

  test("task metadata payload normalizes missing top-level delivery fields independently", () => {
    const parsed = taskMetadataPayloadSchema.parse({
      spec: {
        markdown: "",
        updatedAt: null,
      },
      plan: {
        markdown: "",
        updatedAt: null,
      },
      pullRequest: {
        providerId: "github",
        number: 77,
        url: "https://github.com/openai/openducktor/pull/77",
        state: "draft",
        createdAt: "2026-02-21T09:30:00Z",
        updatedAt: "2026-02-21T09:45:00Z",
      },
      delivery: {
        linkedPullRequest: {
          providerId: "github",
          number: 42,
          url: "https://github.com/openai/openducktor/pull/42",
          state: "open",
          createdAt: "2026-02-20T09:30:00Z",
          updatedAt: "2026-02-20T09:45:00Z",
        },
        directMerge: {
          method: "rebase",
          sourceBranch: "task/openducktor-dpp",
          targetBranch: {
            remote: "origin",
            branch: "main",
          },
          mergedAt: "2026-02-21T10:00:00Z",
        },
      },
      agentSessions: [],
    });

    expect(parsed.pullRequest?.number).toBe(77);
    expect(parsed.directMerge?.method).toBe("rebase");
  });

  test("mcp document reads accept optional document-level decode errors", () => {
    const parsed = taskDocumentsReadSchema.parse({
      documents: {
        spec: {
          markdown: "",
          updatedAt: "2026-02-20T09:00:00Z",
          error: "Failed to decode openducktor.documents.spec[0]: invalid base64 payload",
        },
        latestQaReport: {
          markdown: "",
          updatedAt: null,
          verdict: "not_reviewed",
          error: "Failed to decode openducktor.documents.qaReports[0]: invalid gzip payload",
        },
      },
    });

    expect(parsed.documents.spec?.error).toContain("invalid base64 payload");
    expect(parsed.documents.latestQaReport?.error).toContain("invalid gzip payload");
  });
});
