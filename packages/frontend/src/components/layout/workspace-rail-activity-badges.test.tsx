import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { WorkspaceRailActivityBadges } from "./workspace-rail-activity-badges";
import { workspaceActivityBadges } from "./workspace-rail-activity-badges-model";

describe("WorkspaceRailActivityBadges", () => {
  test("shares the running dot while preserving badge order, labels, and rail sizing", () => {
    const { container, getByTitle, getByTestId } = render(
      <WorkspaceRailActivityBadges
        badges={workspaceActivityBadges({
          kind: "ready",
          inputRequired: true,
          error: true,
          active: true,
        })}
        describedById="workspace-activity"
      />,
    );

    const strip = getByTestId("workspace-rail-activity-badges");
    expect(strip.id).toBe("workspace-activity");
    expect(Array.from(strip.children, (badge) => badge.getAttribute("title"))).toEqual([
      "Sessions waiting for input",
      "Sessions failed",
      "Sessions running",
    ]);
    expect(getByTitle("Sessions waiting for input").className).toContain("bg-warning-accent");
    expect(getByTitle("Sessions failed").className).toContain("bg-destructive");
    const activeBadge = getByTitle("Sessions running");
    expect(activeBadge.className).toContain("size-2.5");
    expect(activeBadge.querySelector(".sr-only")?.textContent).toBe("Sessions running");
    const dot = activeBadge.querySelector(".running-status-dot");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(dot?.className).toContain("size-2.5");
    expect(getByTitle("Sessions waiting for input").classList.contains("size-2.5")).toBe(true);
    expect(dot?.querySelector("svg")).toBeNull();
    const fill = dot?.querySelector("span");
    expect(fill?.classList.contains("size-full")).toBe(true);
    expect(fill?.classList.contains("rounded-full")).toBe(true);
    expect(fill?.classList.contains("bg-status-running")).toBe(true);
    expect(fill?.classList.contains("relative")).toBe(true);
    expect(fill?.classList.contains("z-1")).toBe(true);
    expect(container.querySelectorAll(".running-status-dot")).toHaveLength(1);
  });

  test("does not render a running dot for unavailable activity or an empty strip", () => {
    const { container, getByTitle, rerender } = render(
      <WorkspaceRailActivityBadges
        badges={workspaceActivityBadges({ kind: "unavailable", reason: "stream closed" })}
        describedById="workspace-activity"
      />,
    );

    const errorBadge = getByTitle("Session activity unavailable: stream closed");
    expect(errorBadge.className).toContain("bg-destructive");
    expect(errorBadge.textContent).toBe("Session activity unavailable: stream closed");
    expect(container.querySelector(".running-status-dot")).toBeNull();
    rerender(<WorkspaceRailActivityBadges badges={[]} describedById="workspace-activity" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("workspaceActivityBadges", () => {
  test("shows no badge while the activity is unknown", () => {
    expect(workspaceActivityBadges({ kind: "unknown" })).toEqual([]);
  });

  test("shows no badge when no session state applies", () => {
    expect(
      workspaceActivityBadges({
        kind: "ready",
        inputRequired: false,
        error: false,
        active: false,
      }),
    ).toEqual([]);
  });

  test("orders input required, then error, then active", () => {
    expect(
      workspaceActivityBadges({ kind: "ready", inputRequired: true, error: true, active: true }),
    ).toEqual([
      { key: "inputRequired", label: "Sessions waiting for input" },
      { key: "error", label: "Sessions failed" },
      { key: "active", label: "Sessions running" },
    ]);
  });

  test("shows only the error badge with the reported reason when activity is unavailable", () => {
    expect(workspaceActivityBadges({ kind: "unavailable", reason: "stream closed" })).toEqual([
      { key: "error", label: "Session activity unavailable: stream closed" },
    ]);
  });
});
