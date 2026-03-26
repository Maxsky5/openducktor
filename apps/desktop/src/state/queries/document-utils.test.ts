import { describe, expect, test } from "bun:test";
import type { TaskDocumentPayload } from "@/types/task-documents";
import { resolveLatestDocumentPayload, toUpdatedAtTimestamp } from "./document-utils";

const payload = (overrides: Partial<TaskDocumentPayload>): TaskDocumentPayload => ({
  markdown: "",
  updatedAt: null,
  ...overrides,
});

describe("document-utils", () => {
  test("toUpdatedAtTimestamp returns null for invalid values", () => {
    expect(toUpdatedAtTimestamp(null)).toBeNull();
    expect(toUpdatedAtTimestamp("not-a-date")).toBeNull();
  });

  test("resolveLatestDocumentPayload keeps newer timestamped payload", () => {
    const current = payload({ markdown: "# Current", updatedAt: "2026-03-26T20:00:00.000Z" });
    const incoming = payload({ markdown: "# Incoming old", updatedAt: "2026-03-26T19:59:00.000Z" });

    expect(resolveLatestDocumentPayload(current, incoming)).toEqual(current);
  });

  test("resolveLatestDocumentPayload applies incoming null timestamp when content changed", () => {
    const current = payload({ markdown: "# Existing", updatedAt: "2026-03-26T20:00:00.000Z" });
    const incoming = payload({ markdown: "", updatedAt: null });

    expect(resolveLatestDocumentPayload(current, incoming)).toEqual(incoming);
  });

  test("resolveLatestDocumentPayload keeps current null-timestamp incoming when content unchanged", () => {
    const current = payload({ markdown: "# Existing", updatedAt: "2026-03-26T20:00:00.000Z" });
    const incoming = payload({ markdown: "# Existing", updatedAt: null });

    expect(resolveLatestDocumentPayload(current, incoming)).toEqual(current);
  });
});
