import { describe, expect, test } from "bun:test";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { QueryProvider } from "@/test-utils/query-provider";
import { VersionSwitcher } from "./version-switcher";

function CurrentRoute(): ReactElement {
  return <output aria-label="Current route">{useLocation().pathname}</output>;
}

const renderSwitcher = (routeVersion: number | null, hasDraft: boolean) => {
  const connection = createTestClientConnection({
    client: {
      workflowVersionsList: async () => [
        { version: 1, publishedAt: "2026-11-01T10:00:00.000Z", taskCount: 0 },
        { version: 3, publishedAt: "2026-11-20T10:00:00.000Z", taskCount: 2 },
        { version: 2, publishedAt: "2026-11-10T10:00:00.000Z", taskCount: 1 },
      ],
    },
  });
  render(
    <QueryProvider connection={connection}>
      <MemoryRouter initialEntries={["/workflows/bug_fix/versions/2"]}>
        <VersionSwitcher
          workflowId="bug_fix"
          status={{ label: "Version 2 · Read-only", tone: "locked" }}
          routeVersion={routeVersion}
          latestVersion={3}
          hasDraft={hasDraft}
        />
        <CurrentRoute />
      </MemoryRouter>
    </QueryProvider>,
  );
};

const openMenu = async (): Promise<HTMLElement> => {
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Version 2 · Read-only. Open another version" }),
    { key: "Enter" },
  );
  const menu = await screen.findByRole("menu");
  await within(menu).findByRole("menuitem", { name: /Version 1/ });
  return menu;
};

describe("VersionSwitcher", () => {
  test("lists the draft, then the versions from the newest, and marks the open version", async () => {
    renderSwitcher(2, true);
    const menu = await openMenu();

    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "DraftUnpublished changes",
      expect.stringContaining("Version 3Latest"),
      expect.stringContaining("Version 2"),
      expect.stringContaining("Version 1"),
    ]);
    expect(items[1]?.textContent).toContain("2 tasks");
    expect(items[2]?.getAttribute("aria-current")).toBe("page");
    expect(items[0]?.getAttribute("aria-current")).toBeNull();
  });

  test("opens another version, or the editable workflow", async () => {
    renderSwitcher(2, false);
    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: /^Version 3/ }));
    expect(screen.getByLabelText("Current route").textContent).toBe(
      "/workflows/bug_fix/versions/3",
    );
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    fireEvent.click(within(await openMenu()).getByRole("menuitem", { name: /^Current workflow/ }));
    expect(screen.getByLabelText("Current route").textContent).toBe("/workflows/bug_fix");
  });
});
