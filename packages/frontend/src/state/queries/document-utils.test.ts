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

    expect(resolveLatestDocumentPayload(current, incoming)).toBe(current);
  });

  test("resolveLatestDocumentPayload applies incoming null timestamp when content changed", () => {
    const current = payload({ markdown: "# Existing", updatedAt: "2026-03-26T20:00:00.000Z" });
    const incoming = payload({ markdown: "", updatedAt: null });

    expect(resolveLatestDocumentPayload(current, incoming)).toBe(incoming);
  });

  test("resolveLatestDocumentPayload keeps current null-timestamp incoming when content unchanged", () => {
    const current = payload({ markdown: "# Existing", updatedAt: "2026-03-26T20:00:00.000Z" });
    const incoming = payload({ markdown: "# Existing", updatedAt: null });

    expect(resolveLatestDocumentPayload(current, incoming)).toBe(current);
  });

  test("resolveLatestDocumentPayload accepts incoming data when current data is absent", () => {
    const incoming = payload({ markdown: "# Incoming" });

    expect(resolveLatestDocumentPayload(undefined, incoming)).toBe(incoming);
  });

  test.each(["2026-03-26T20:01:00.000Z", "2026-03-26T20:00:00.000Z"])(
    "resolveLatestDocumentPayload accepts a newer or equal timestamp %s",
    (updatedAt) => {
      const current = payload({ markdown: "# Current", updatedAt: "2026-03-26T20:00:00.000Z" });
      const incoming = payload({ markdown: "# Incoming", updatedAt });

      expect(resolveLatestDocumentPayload(current, incoming)).toBe(incoming);
    },
  );

  test.each([
    [null, null],
    [null, "2026-03-26T20:00:00.000Z"],
    ["invalid-current", "2026-03-26T20:00:00.000Z"],
    ["invalid-current", "invalid-incoming"],
  ])(
    "resolveLatestDocumentPayload accepts incoming data with current timestamp %s and incoming timestamp %s",
    (currentUpdatedAt, incomingUpdatedAt) => {
      const current = payload({ markdown: "# Current", updatedAt: currentUpdatedAt });
      const incoming = payload({ markdown: "# Incoming", updatedAt: incomingUpdatedAt });

      expect(resolveLatestDocumentPayload(current, incoming)).toBe(incoming);
    },
  );

  test.each(["# Current", "# Changed"])(
    "resolveLatestDocumentPayload treats an invalid incoming timestamp as missing for %s",
    (markdown) => {
      const current = payload({ markdown: "# Current", updatedAt: "2026-03-26T20:00:00.000Z" });
      const incoming = payload({ markdown, updatedAt: "invalid-incoming" });

      expect(resolveLatestDocumentPayload(current, incoming)).toBe(
        markdown === current.markdown ? current : incoming,
      );
    },
  );

  test("resolveLatestDocumentPayload retains the current error when incoming data is older", () => {
    const current = payload({
      markdown: "# Current",
      updatedAt: "2026-03-26T20:00:00.000Z",
      error: "Current document error",
    });
    const incoming = payload({
      markdown: "# Older",
      updatedAt: "2026-03-26T19:59:00.000Z",
      error: "Older document error",
    });

    expect(resolveLatestDocumentPayload(current, incoming)).toBe(current);
  });

  test.each([{ error: "Incoming document error" }, { error: null }, {}])(
    "resolveLatestDocumentPayload accepts the incoming error fields %j",
    (errorFields) => {
      const current = payload({
        markdown: "# Current",
        updatedAt: "2026-03-26T20:00:00.000Z",
        error: "Current document error",
      });
      const incoming = payload({
        markdown: "# Incoming",
        updatedAt: "2026-03-26T20:01:00.000Z",
        ...errorFields,
      });

      expect(resolveLatestDocumentPayload(current, incoming)).toBe(incoming);
    },
  );
});
