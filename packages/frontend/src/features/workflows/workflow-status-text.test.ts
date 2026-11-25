import { describe, expect, test } from "bun:test";
import { workflowStatus } from "./workflow-status-text";

const status = (hasDraft: boolean, latestVersion: number | null) =>
  workflowStatus({ builtin: false, routeVersion: null, hasDraft, latestVersion });

describe("workflow status", () => {
  test("a draft before the first publication reads Draft", () => {
    expect(status(true, null)).toEqual({ label: "Draft", tone: "draft" });
  });

  test("a draft after a publication names the version and the unpublished changes", () => {
    expect(status(true, 2)).toEqual({ label: "Version 2 · Unpublished changes", tone: "draft" });
  });

  test("a published workflow without a draft names its version", () => {
    expect(status(false, 2)).toEqual({ label: "Version 2 · Published", tone: "published" });
  });

  test("the built-in workflow and a version route are locked", () => {
    expect(
      workflowStatus({ builtin: true, routeVersion: null, hasDraft: false, latestVersion: 1 }),
    ).toEqual({ label: "Built-in", tone: "locked" });
    expect(
      workflowStatus({ builtin: false, routeVersion: 1, hasDraft: true, latestVersion: 2 }),
    ).toEqual({ label: "Version 1 · Read-only", tone: "locked" });
  });
});
