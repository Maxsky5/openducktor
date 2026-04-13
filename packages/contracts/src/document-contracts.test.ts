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
