import { describe, expect, test } from "bun:test";
import { IMPORT_TEXT } from "./replicas/studio/import-session-text";
import { ISSUE_IMPORT, MATCHES, SESSIONS } from "./scenes/import-session/sample";
import { importProduct, readProduct } from "./test-support/product-source";

// The dialog has its words in its markup, so the test reads the product source as text.
const dialogSource = (
  await Promise.all(
    [
      "workspace-session-import-dialog.tsx",
      "workspace-session-import-search.tsx",
      "workspace-session-import-results.tsx",
    ].map((file) => readProduct(`packages/frontend/src/pages/workspace-sessions/${file}`)),
  )
).join("\n");
const menuSource = await readProduct(
  "packages/frontend/src/components/layout/sidebar/session-create-split-action.tsx",
);
// SAFETY: issue-import-provider.ts exports this function, and a missing export fails the test.
const { issueImportActionLabel } = await importProduct<{
  issueImportActionLabel: (state: {
    kind: "ready";
    provider: { config: { id: string } };
  }) => string;
}>("packages/frontend-core/src/tasks/issue-import/issue-import-provider.ts");
// SAFETY: task-execution-ci-relative-time-format.ts exports this function, and a missing export
// fails the test.
const { formatCiRelativeTime } = await importProduct<{
  formatCiRelativeTime: (timestamp: string, now: number) => string;
}>("packages/frontend-core/src/review/task-execution-ci-relative-time-format.ts");

describe("the import session copied from the app", () => {
  test("the menu names the import and the issue import of a GitHub workspace", () => {
    expect(menuSource).toContain('"Import session from an external runtime"');
    expect(issueImportActionLabel({ kind: "ready", provider: { config: { id: "github" } } })).toBe(
      ISSUE_IMPORT,
    );
  });

  test("the dialog uses the words of the app", () => {
    for (const text of Object.values(IMPORT_TEXT)) expect(dialogSource).toContain(text);
  });

  test("the rows show the relative time of the app", () => {
    const now = Date.parse("2026-05-04T12:00:00Z");
    const hours = (count: number): string => new Date(now - count * 3_600_000).toISOString();
    expect(SESSIONS.map((session) => session.updated)).toEqual(
      [2, 24, 72, 144].map((count) => formatCiRelativeTime(hours(count), now)),
    );
  });

  test("the search matches the two rows that the list shows in full", () => {
    expect(MATCHES).toHaveLength(2);
  });
});
