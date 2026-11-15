import { useShortcutTitle } from "../shortcuts/shortcut-controls";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { useLocalShortcuts } from "../shortcuts/use-local-shortcuts";
import { useShortcutLabel } from "../shortcuts/use-shortcut-label";
import { expect, test, spyOn } from "bun:test";
import { act, render } from "@testing-library/react";
import { Command } from "lucide-react";
import { use, useRef, Activity } from "react";
import {
  CommandPaletteRegistryContext,
  CommandPaletteRegistryProvider,
  useCommandPaletteCommands,
} from "./command-palette-registry";

test("command updates publish fresh snapshots without rerendering registration owners", async () => {
  let renders = 0;
  let registry!: NonNullable<ReturnType<typeof useRegistry>>;
  function useRegistry() {
    return use(CommandPaletteRegistryContext);
  }
  function Control() {
    renders++;
    registry = useRegistry()!;
    return <button>Control</button>;
  }
  const view = render(
    <CommandPaletteRegistryProvider>
      <Control />
    </CommandPaletteRegistryProvider>,
  );
  const before = renders;
  let notifications = 0;
  const unsubscribe = registry.subscribe(() => notifications++);
  const first = {
    id: "task-edit" as const,
    label: "Edit task",
    icon: Command,
    keywords: [],
    run() {},
  };
  const second = { ...first, label: "Edit another task" };
  try {
    const empty = registry.pageCommands;
    expect(registry.pageCommands).toBe(empty);
    await act(async () => {
      const releaseFirst = registry.registerPageCommand(first);
      const releaseSecond = registry.registerPageCommand(second);
      const added = registry.pageCommands;
      expect(added).toEqual([first, second]);
      expect(registry.pageCommands).toBe(added);
      registry.invalidatePageCommands();
      expect(registry.pageCommands).not.toBe(added);
      expect(registry.pageCommands).toEqual(added);
      releaseFirst();
      expect(registry.pageCommands).toEqual([second]);
      releaseSecond();
      expect(registry.pageCommands).toEqual([]);
      expect(added).toEqual([first, second]);
    });
    expect(empty).toEqual([]);
    expect(notifications).toBe(1);
    expect(renders).toBe(before);
  } finally {
    unsubscribe();
    view.unmount();
  }
});

test("changing another command label does not rerender an unchanged control", () => {
  let renders = 0;
  let registry: NonNullable<ReturnType<typeof useRegistry>>;
  function useRegistry() {
    return use(CommandPaletteRegistryContext);
  }
  function Control() {
    registry = useRegistry()!;
    renders++;
    return <button>{useShortcutLabel("sidebar", "control")}</button>;
  }
  const view = render(
    <CommandPaletteRegistryProvider>
      <Control />
    </CommandPaletteRegistryProvider>,
  );
  try {
    act(() =>
      registry.shortcutLabels!.replace(
        new Map([["sidebar", { label: "Ctrl+B", keys: [], aria: "", owner: null }]]),
      ),
    );
    const before = renders;
    act(() =>
      registry.shortcutLabels!.replace(
        new Map([
          ["sidebar", { label: "Ctrl+B", keys: [], aria: "", owner: null }],
          ["task-edit", { label: "Ctrl+E", keys: [], aria: "", owner: "task-1" }],
        ]),
      ),
    );
    expect(view.getByRole("button").textContent).toBe("Ctrl+B");
    expect(renders).toBe(before);
  } finally {
    view.unmount();
  }
});

test("registering local shortcuts does not force layout during a page render", () => {
  function Control() {
    const root = useRef<HTMLButtonElement>(null);
    useLocalShortcuts(root, [{ id: "message-fork" as const, run() {} }]);
    return <button ref={root}>Fork reply</button>;
  }
  const measure = spyOn(HTMLElement.prototype, "getClientRects");
  const view = render(
    <CommandPaletteRegistryProvider>
      <Control />
    </CommandPaletteRegistryProvider>,
  );
  try {
    expect(measure).toHaveBeenCalledTimes(0);
  } finally {
    view.unmount();
    measure.mockRestore();
  }
});

test("local shortcut controls do not subscribe to session activation", () => {
  let renders = 0;
  function Control() {
    renders++;
    const root = useRef<HTMLButtonElement>(null);
    useLocalShortcuts(root, [{ id: "message-fork" as const, run() {} }]);
    const title = useShortcutTitle("message-fork", "Fork reply");
    return (
      <button ref={root} title={title}>
        Fork reply
      </button>
    );
  }
  const control = <Control />;
  const tree = (isActive: boolean) => (
    <CommandPaletteRegistryProvider>
      <SessionViewContext value={{ id: "view", isActive }}>{control}</SessionViewContext>
    </CommandPaletteRegistryProvider>
  );
  const view = render(tree(true));
  try {
    const before = renders;
    view.rerender(tree(false));
    expect(renders).toBe(before);
  } finally {
    view.unmount();
  }
});

test("hidden kept views release their shortcut registrations through Activity", async () => {
  function Control() {
    const root = useRef<HTMLButtonElement>(null);
    useLocalShortcuts(root, [{ id: "message-fork" as const, run() {} }]);
    return <button ref={root}>Fork reply</button>;
  }
  function Commands() {
    return <output aria-label="Registered commands">{useCommandPaletteCommands().length}</output>;
  }
  const control = <Control />;
  const tree = (shown: boolean) => (
    <CommandPaletteRegistryProvider>
      <Commands />
      <Activity mode={shown ? "visible" : "hidden"}>{control}</Activity>
    </CommandPaletteRegistryProvider>
  );
  const view = render(tree(true));
  try {
    await act(async () => {});
    expect(view.getByLabelText("Registered commands").textContent).toBe("1");
    await act(async () => view.rerender(tree(false)));
    expect(view.getByLabelText("Registered commands").textContent).toBe("0");
    await act(async () => view.rerender(tree(true)));
    expect(view.getByLabelText("Registered commands").textContent).toBe("1");
  } finally {
    view.unmount();
  }
});
