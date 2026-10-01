import { SessionNavigationTestProvider } from "./session-navigation-test-provider";
import { describe, expect, spyOn, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SessionNavigationList } from "./session-navigation-list";
import { SessionNavigationRail } from "./session-navigation-rail";
import { NOW, navigationModel, workspaceSessionEntry } from "./session-navigation.test-support";

const moving = workspaceSessionEntry("moving");
const kept = workspaceSessionEntry("kept");

const pendingAnimation = () => {
  const completion = Promise.withResolvers<Animation>();
  // SAFETY: The native animation boundary only needs its finished promise in these tests.
  const animation = { finished: completion.promise } as Animation;
  return { animation, finish: () => completion.resolve(animation) };
};

const list = (model: ReturnType<typeof navigationModel>) => (
  <SessionNavigationTestProvider>
    <SessionNavigationList
      model={model}
      selection={{ entryKey: moving.key, visibleKey: moving.key }}
      now={NOW}
      onOpen={() => {}}
      onRetry={() => {}}
    />
  </SessionNavigationTestProvider>
);

describe("Session navigation presence", () => {
  test.each([
    ["Expanded sidebar", SessionNavigationList],
    ["Collapsed sidebar", SessionNavigationRail],
  ] as const)(
    "%s keeps Needs you and Running mounted through loading and empty states",
    async (_mode, Component) => {
      const navigation = (model: ReturnType<typeof navigationModel>) => (
        <SessionNavigationTestProvider>
          <Component
            model={model}
            selection={{ entryKey: moving.key, visibleKey: moving.key }}
            now={NOW}
            onOpen={() => {}}
            onRetry={() => {}}
          />
        </SessionNavigationTestProvider>
      );
      const view = render(navigation(navigationModel({}, { isLoading: true })));
      const needsYou = screen.getByRole("region", { name: "Needs you" });
      const running = screen.getByRole("region", { name: "Running" });
      expect(within(needsYou).getByText("0")).toBeTruthy();
      expect(within(running).getByText("0")).toBeTruthy();

      view.rerender(
        navigation(navigationModel({ running: [{ ...moving, status: { kind: "running" } }] })),
      );
      const initialRow = within(running)
        .getByRole("button", { name: /Chat moving/ })
        .closest("li")!;
      expect(initialRow.getAttribute("data-animate-entry")).toBe("false");
      expect(within(running).getByText("1")).toBeTruthy();

      view.rerender(
        navigation(navigationModel({ needs_you: [{ ...moving, attention: ["question"] }] })),
      );
      expect(within(needsYou).getByRole("button", { name: /Chat moving/ })).toBeTruthy();
      expect(within(needsYou).getByText("1")).toBeTruthy();
      expect(within(running).getByText("0")).toBeTruthy();

      view.rerender(navigation(navigationModel({})));
      await waitFor(() => expect(view.container.querySelectorAll("li")).toHaveLength(0));
      expect(screen.getByRole("region", { name: "Needs you" })).toBe(needsYou);
      expect(screen.getByRole("region", { name: "Running" })).toBe(running);
      expect(within(needsYou).getByText("0")).toBeTruthy();
      expect(within(running).getByText("0")).toBeTruthy();
      expect(screen.queryByRole("region", { name: "Recent" })).toBeNull();
    },
  );

  test.each([true, false])(
    "closes the removed session's card during its exit, sibling retained: %p",
    async (retainSibling) => {
      const view = render(
        list(navigationModel({ recent: retainSibling ? [moving, kept] : [moving] })),
      );
      const button = screen.getByRole("button", { name: /Chat moving/ });
      const row = button.closest("li")!;
      const exiting = retainSibling ? row : screen.getByRole("region", { name: "Recent" });
      fireEvent.focus(button);
      const card = await waitFor(() => {
        const content = document.querySelector('[data-slot="popover-content"]');
        if (!content) throw new Error("The session details card is not open.");
        return content;
      });
      const exit = pendingAnimation();
      const animations = spyOn(exiting, "getAnimations").mockReturnValue([exit.animation]);
      try {
        view.rerender(list(navigationModel({ recent: retainSibling ? [kept] : [] })));

        expect(view.container.contains(row)).toBe(true);
        expect(exiting.hasAttribute("inert")).toBe(true);
        expect(exiting.getAttribute("aria-hidden")).toBe("true");
        expect(screen.queryByRole("button", { name: /Chat moving/ })).toBeNull();
        expect(card.isConnected && card.getAttribute("data-state") !== "closed").toBe(false);
        if (retainSibling) expect(screen.getByLabelText("1 session").textContent).toBe("1");

        await act(async () => exit.finish());
        await waitFor(() => expect(view.container.contains(row)).toBe(false));
      } finally {
        animations.mockRestore();
      }
    },
  );

  test("cancels an exit when the same session returns and waits for its next removal", async () => {
    const view = render(list(navigationModel({ recent: [moving, kept] })));
    const row = screen.getByRole("button", { name: /Chat moving/ }).closest("li")!;
    const firstExit = pendingAnimation();
    const nextExit = pendingAnimation();
    const animations = spyOn(row, "getAnimations")
      .mockReturnValueOnce([firstExit.animation])
      .mockReturnValueOnce([nextExit.animation]);
    try {
      view.rerender(list(navigationModel({ recent: [kept] })));
      view.rerender(list(navigationModel({ recent: [moving, kept] })));
      await act(async () => firstExit.finish());

      expect(row.hasAttribute("inert")).toBe(false);
      expect(screen.getAllByRole("button", { name: /Chat moving/ })).toHaveLength(1);

      view.rerender(list(navigationModel({ recent: [kept] })));
      expect(view.container.contains(row)).toBe(true);
      await act(async () => nextExit.finish());
      await waitFor(() => expect(view.container.contains(row)).toBe(false));
    } finally {
      animations.mockRestore();
    }
  });

  test("a section move prepares the destination while keeping its empty source header", async () => {
    const running = { ...moving, status: { kind: "running" as const } };
    const view = render(list(navigationModel({ running: [running], recent: [kept] })));
    const source = screen.getByRole("region", { name: "Running" });
    const sourceRow = within(source)
      .getByRole("button", { name: /Chat moving/ })
      .closest("li")!;
    const exit = pendingAnimation();
    let entranceAtStyleRead: string | null | undefined;
    const animations = spyOn(sourceRow, "getAnimations").mockImplementation(() => {
      // Native getAnimations flushes styles for inserted siblings, before their layout effects.
      entranceAtStyleRead = view.container
        .querySelector('section[aria-label="Recent"] button[aria-current="true"]')
        ?.closest("li")
        ?.getAttribute("data-animate-entry");
      return [exit.animation];
    });
    try {
      view.rerender(list(navigationModel({ recent: [moving, kept] })));

      expect(entranceAtStyleRead).toBe("true");
      expect(view.container.contains(sourceRow)).toBe(true);
      expect(sourceRow.hasAttribute("inert")).toBe(true);
      expect(screen.getByRole("region", { name: "Running" })).toBe(source);
      expect(within(source).getByLabelText("0 sessions").textContent).toBe("0");
      const destination = screen.getByRole("region", { name: "Recent" });
      expect(within(destination).getByRole("button", { name: /Chat moving/ })).toBeTruthy();
      expect(screen.getAllByRole("button", { name: /Chat moving/ })).toHaveLength(1);

      await act(async () => exit.finish());
      await waitFor(() => expect(view.container.contains(sourceRow)).toBe(false));
      expect(screen.getByRole("region", { name: "Running" })).toBe(source);
    } finally {
      animations.mockRestore();
    }
  });
});
