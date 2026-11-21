import { describe, expect, test } from "bun:test";
import { availabilitySummary, availableNowhere } from "./workflow-availability";

const workspaces = [
  { workspaceId: "a", workspaceName: "Alpha" },
  { workspaceId: "b", workspaceName: "Beta" },
  { workspaceId: "c", workspaceName: "Gamma" },
];

describe("availabilitySummary", () => {
  test("names up to two repositories, then counts them", () => {
    expect(availabilitySummary({ mode: "all" }, workspaces)).toBe("All repositories");
    expect(availabilitySummary({ mode: "only", workspaceIds: ["b"] }, workspaces)).toBe(
      "Only Beta",
    );
    expect(availabilitySummary({ mode: "except", workspaceIds: ["a", "c"] }, workspaces)).toBe(
      "All except Alpha, Gamma",
    );
    expect(availabilitySummary({ mode: "only", workspaceIds: ["a", "b", "c"] }, workspaces)).toBe(
      "Only 3 repositories",
    );
  });

  test("ignores a listed repository that this host does not know", () => {
    expect(availabilitySummary({ mode: "only", workspaceIds: ["gone"] }, workspaces)).toBe(
      "No repository",
    );
    expect(availabilitySummary({ mode: "except", workspaceIds: ["gone"] }, workspaces)).toBe(
      "All repositories",
    );
  });
});

describe("availableNowhere", () => {
  test("is true when the rule leaves out every repository", () => {
    expect(availableNowhere({ mode: "only", workspaceIds: [] }, workspaces)).toBe(true);
    expect(availableNowhere({ mode: "except", workspaceIds: ["a", "b", "c"] }, workspaces)).toBe(
      true,
    );
    expect(availableNowhere({ mode: "except", workspaceIds: ["a"] }, workspaces)).toBe(false);
    expect(availableNowhere({ mode: "all" }, workspaces)).toBe(false);
  });
});
