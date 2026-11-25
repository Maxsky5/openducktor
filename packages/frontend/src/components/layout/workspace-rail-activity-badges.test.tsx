import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { WorkspaceRailActivityBadges } from "./workspace-rail-activity-badges";
import { workspaceActivityBadges } from "@openducktor/frontend-core/workspace-activity/workspace-activity-badges";

describe("WorkspaceRailActivityBadges", () => {
  test("lists waiting, failed, and running workspace activity in order", () => {
    const { getByTestId } = render(
      <WorkspaceRailActivityBadges
        badges={workspaceActivityBadges({
          kind: "ready",
          statusUnavailableReason: null,
          inputRequired: true,
          error: true,
          active: true,
        })}
        describedById="workspace-activity"
      />,
    );

    const strip = getByTestId("workspace-rail-activity-badges");
    expect(strip.id).toBe("workspace-activity");
    const labels = ["Sessions waiting for input", "Sessions failed", "Sessions running"];
    expect(Array.from(strip.children, (badge) => badge.getAttribute("title"))).toEqual(labels);
    expect(Array.from(strip.children, (badge) => badge.textContent)).toEqual(labels);
  });

  test("names unavailable activity and has no label without badges", () => {
    const { getByTitle, queryByTestId, queryByTitle, rerender } = render(
      <WorkspaceRailActivityBadges
        badges={workspaceActivityBadges({ kind: "unavailable", reason: "stream closed" })}
        describedById="workspace-activity"
      />,
    );

    const unavailableBadge = getByTitle("Session activity unavailable: stream closed");
    expect(unavailableBadge.textContent).toBe("Session activity unavailable: stream closed");
    expect(queryByTitle("Sessions running") === null).toBe(true);
    rerender(<WorkspaceRailActivityBadges badges={[]} describedById="workspace-activity" />);
    expect(queryByTestId("workspace-rail-activity-badges") === null).toBe(true);
  });
});
