import { SettingsKeyboardShortcutsSection } from "@/components/features/settings/settings-keyboard-shortcuts-section";
import { use, useState } from "react";
import { Command } from "lucide-react";
import {
  CommandPaletteRegistryContext,
  CommandPaletteRegistryProvider,
  useCommandPaletteCommands,
} from "../command-palette/command-palette-registry";
import { useCommandPalettePageCommand } from "../command-palette/command-palette-context";
import type { ElectronShortcutBridge, EmbeddedShortcutEvent } from "@openducktor/contracts";
import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ElectronShortcutRules } from "@openducktor/contracts";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { configureShellBridge, createUnavailableShellBridge } from "@/lib/shell-bridge";
import { useShortcutDispatch } from "./use-shortcut-dispatch";
import { embeddedShortcutSources } from "./embedded-sources";

afterEach(() => {
  cleanup();
  configureShellBridge(createUnavailableShellBridge());
});

function installNativeBridge(
  apply: ElectronShortcutBridge["apply"],
  subscribe: ElectronShortcutBridge["subscribe"] = () => () => {},
): void {
  configureShellBridge({
    ...createUnavailableShellBridge(),
    browser: {
      surface: "electron",
      connect: async () => {
        throw new Error("No guest is used in this test.");
      },
      setSurface: async () => {},
      focusPage: async () => {},
      capturePage: async () => "",
      pickFiles: async () => [],
    },
    shortcuts: {
      apply,
      subscribe,
      release: () => {},
    },
  });
}

test("keeps native guest focus when entering its separate WebContents blurs the renderer", async () => {
  const applied: ElectronShortcutRules[] = [];
  let nativeInput!: (message: { sourceTabId: string | null; event: EmbeddedShortcutEvent }) => void;
  installNativeBridge(
    async (rules) => {
      applied.push(rules);
    },
    (listener) => {
      nativeInput = listener;
      return () => {};
    },
  );
  const connection = createTestClientConnection();
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const root = document.createElement("div");
  root.setAttribute("data-browser-tab-id", "guest");
  document.body.append(root);
  const rects = spyOn(root, "getClientRects").mockReturnValue({
    0: new DOMRect(),
    length: 1,
    item: () => new DOMRect(),
    [Symbol.iterator]: () => [new DOMRect()][Symbol.iterator](),
  });
  const commands = [
    {
      id: "close-panel-tab" as const,
      label: "Close current panel tab",
      icon: Command,
      keywords: [],
      target: { kind: "panel" as const, key: "panel" },
      focusRoot: () => root,
      run: () => {},
    },
  ];
  function Owner() {
    useShortcutDispatch({
      platform: "darwin",
      pageCommands: commands,
      actions: [],
      isOpen: false,
      open: () => {},
      close: () => {},
      runAfterClose: (run) => run(),
    });
    return <button>Renderer input</button>;
  }
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <Owner />
    </ClientConnectionProvider>,
  );
  try {
    act(() => screen.getByRole("button", { name: "Renderer input" }).focus());
    act(() => nativeInput({ sourceTabId: "guest", event: { type: "focus" } }));
    await waitFor(() =>
      expect(applied.at(-1)?.guestRoutes.map((route) => route.commandId)).toContain(
        "close-panel-tab",
      ),
    );
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    expect(applied.at(-1)?.guestRoutes.map((route) => route.commandId)).toContain(
      "close-panel-tab",
    );
  } finally {
    view.unmount();
    root.remove();
    rects.mockRestore();
  }
});

test("blocks DOM commands after native installation fails and restores routing on Retry", async () => {
  let fail = true;
  const applied: ElectronShortcutRules[] = [];
  installNativeBridge(async (rules) => {
    if (fail) throw new Error("Native input failed.");
    applied.push(rules);
  });
  const connection = createTestClientConnection();
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const run = mock(() => {});
  function Owner() {
    const routing = useShortcutDispatch({
      platform: "darwin",
      pageCommands: [],
      actions: [
        {
          key: "action:sidebar",
          label: "Toggle sidebar",
          workspaceName: null,
          icon: null,
          keywords: [],
          suggested: false,
          disabledReason: null,
          checked: false,
          run,
        },
      ],
      isOpen: false,
      open: () => {},
      close: () => {},
      runAfterClose: (operation) => operation(),
    });
    return (
      <>
        <output>{routing.inputError ?? "Ready"}</output>
        <button onClick={routing.retry}>Retry</button>
      </>
    );
  }
  render(
    <ClientConnectionProvider connection={connection}>
      <Owner />
    </ClientConnectionProvider>,
  );
  await screen.findByText("Native input failed.");
  expect(fireEvent.keyDown(window, { key: "b", ctrlKey: true })).toBe(true);
  expect(run).not.toHaveBeenCalled();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.getByText("Ready")).toBeTruthy());
  expect(applied.at(-1)?.suppressMenuFor).toContainEqual({
    key: { kind: "logical", key: "b" },
    ctrl: true,
    meta: false,
    alt: false,
    shift: false,
  });
  expect(fireEvent.keyDown(window, { key: "b", ctrlKey: true })).toBe(false);
  expect(run).toHaveBeenCalledTimes(1);
});

test("refreshes native claims when owner and app action availability changes", async () => {
  const applied: ElectronShortcutRules[] = [];
  installNativeBridge(async (rules) => {
    applied.push(rules);
  });
  const connection = createTestClientConnection();
  connection.queryClient.setQueryData(["keyboard-shortcuts"], {
    version: 1,
    overrides: {
      "session-stop": {
        key: { kind: "logical", key: "r" },
        meta: true,
        ctrl: false,
        alt: false,
        shift: false,
      },
    },
  });
  function Operation({ available }: { available: boolean }) {
    useCommandPalettePageCommand({
      id: "session-stop",
      label: "Stop run",
      icon: Command,
      keywords: [],
      target: { kind: "session", key: "fixed-session" },
      disabledReason: () => (available ? null : "No run is active."),
      run: () => {},
    });
    return null;
  }
  function Routing({ available }: { available: boolean }) {
    const registry = use(CommandPaletteRegistryContext);
    if (!registry) throw new Error("Missing registry");
    useShortcutDispatch({
      platform: "darwin",
      pageCommands: useCommandPaletteCommands(),
      actions: [
        {
          key: "action:sidebar",
          label: "Toggle sidebar",
          workspaceName: null,
          icon: null,
          keywords: [],
          suggested: false,
          disabledReason: available ? null : "No sidebar.",
          checked: false,
          run: () => {},
        },
      ],
      isOpen: false,
      open: () => {},
      close: () => {},
      runAfterClose: (run) => run(),
    });
    return <Operation available={available} />;
  }
  function Harness() {
    const [available, setAvailable] = useState(true);
    return (
      <CommandPaletteRegistryProvider>
        <Routing available={available} />
        <button onClick={() => setAvailable((current) => !current)}>Toggle availability</button>
      </CommandPaletteRegistryProvider>
    );
  }
  render(
    <ClientConnectionProvider connection={connection}>
      <Harness />
    </ClientConnectionProvider>,
  );
  const claimedKeys = () =>
    applied
      .at(-1)
      ?.suppressMenuFor.map((combination) =>
        combination.key.kind === "logical" ? combination.key.key : combination.key.digit,
      );
  await waitFor(() => expect(claimedKeys()).toContain("r"));
  expect(claimedKeys()).toContain("b");
  fireEvent.click(screen.getByRole("button", { name: "Toggle availability" }));
  await waitFor(() => expect(claimedKeys()).not.toContain("r"));
  expect(claimedKeys()).not.toContain("b");
  fireEvent.click(screen.getByRole("button", { name: "Toggle availability" }));
  await waitFor(() => expect(claimedKeys()).toContain("r"));
  expect(claimedKeys()).toContain("b");
});

test("keeps preview failures per source and hides labels and hints until focused routes are ready", async () => {
  const connection = createTestClientConnection();
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const failing = Promise.withResolvers<void>();
  const healthy = Promise.withResolvers<void>();
  const first = { tabId: "failing", apply: mock(() => failing.promise) };
  const second = { tabId: "healthy", apply: mock(() => healthy.promise) };
  const releaseFirst = embeddedShortcutSources.register(first);
  const releaseSecond = embeddedShortcutSources.register(second);
  const actions = [
    {
      key: "action:sidebar",
      label: "Toggle sidebar",
      workspaceName: null,
      icon: null,
      keywords: [],
      suggested: false,
      disabledReason: null,
      checked: false,
      run: () => {},
    },
  ];
  const commands: never[] = [];
  function Owner() {
    const routing = useShortcutDispatch({
      platform: "darwin",
      pageCommands: commands,
      actions,
      isOpen: false,
      open: () => {},
      close: () => {},
      runAfterClose: (run) => run(),
    });
    return (
      <>
        <output data-testid="routing-error">{routing.inputError ?? "Ready"}</output>
        <output data-testid="routing-label">
          {routing.labelForCommand("sidebar") ?? "Unavailable"}
        </output>
        <button onClick={routing.retry}>Retry preview routes</button>
        <div data-browser-tab-id="failing" data-testid="failing-root" />
        <div data-browser-tab-id="healthy" data-testid="healthy-root" />
        {/* Page surfaces live outside the panel slots and can have no working frame script. */}
        <iframe title="Failed page" data-browser-frame-tab-id="failing" />
        <iframe title="Healthy page" data-browser-frame-tab-id="healthy" />
      </>
    );
  }
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <Owner />
    </ClientConnectionProvider>,
  );
  const rects: DOMRectList = {
    0: new DOMRect(),
    length: 1,
    item: () => new DOMRect(),
    [Symbol.iterator]: () => [new DOMRect()][Symbol.iterator](),
  };
  const firstRects = spyOn(screen.getByTestId("failing-root"), "getClientRects").mockReturnValue(
    rects,
  );
  const secondRects = spyOn(screen.getByTestId("healthy-root"), "getClientRects").mockReturnValue(
    rects,
  );
  try {
    act(() => screen.getByTitle("Failed page").focus());
    expect(screen.getByTestId("routing-label").textContent).toBe("Unavailable");
    await act(async () => {
      failing.reject(new Error("First preview rejected routes."));
      await failing.promise.catch(() => {});
    });
    await waitFor(() =>
      expect(screen.getByTestId("routing-error").textContent).toContain(
        "First preview rejected routes.",
      ),
    );
    await act(async () => {
      healthy.resolve();
      await healthy.promise;
    });
    expect(screen.getByTestId("routing-error").textContent).toContain(
      "First preview rejected routes.",
    );
    expect(screen.getByTestId("routing-label").textContent).toBe("Unavailable");
    act(() =>
      embeddedShortcutSources.report(first, {
        type: "key-state",
        input: {
          phase: "down",
          key: "Meta",
          code: "MetaLeft",
          ctrl: false,
          meta: true,
          alt: false,
          shift: false,
          repeat: false,
          composing: false,
        },
      }),
    );
    expect(document.documentElement.hasAttribute("data-shortcut-hints")).toBe(false);
    act(() => screen.getByTitle("Healthy page").focus());
    expect(screen.getByTestId("routing-label").textContent).toBe("Ctrl+B");
    first.apply.mockImplementation(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Retry preview routes" }));
    await waitFor(() => expect(screen.getByTestId("routing-error").textContent).toBe("Ready"));
    act(() => screen.getByTitle("Failed page").focus());
    expect(screen.getByTestId("routing-label").textContent).toBe("Ctrl+B");
  } finally {
    view.unmount();
    releaseFirst();
    releaseSecond();
    firstRects.mockRestore();
    secondRects.mockRestore();
    document.documentElement.removeAttribute("data-shortcut-hints");
  }
});

test.each(["unmount", "blur"] as const)(
  "%s during native preparation releases recording",
  async (cancel) => {
    const prepared = Promise.withResolvers<void>();
    const applied: ElectronShortcutRules[] = [];
    installNativeBridge(async (rules) => {
      applied.push(rules);
      if (rules.recording) await prepared.promise;
    });
    const connection = createTestClientConnection();
    connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
    const run = mock(() => {});
    function Owner() {
      const [showSettings, setShowSettings] = useState(true);
      useShortcutDispatch({
        platform: "darwin",
        pageCommands: [],
        actions: [
          {
            key: "action:sidebar",
            label: "Toggle sidebar",
            workspaceName: null,
            icon: null,
            keywords: [],
            suggested: false,
            disabledReason: null,
            checked: false,
            run,
          },
        ],
        isOpen: false,
        open: () => {},
        close: () => {},
        runAfterClose: (operation) => operation(),
      });
      return (
        <>
          <button onClick={() => setShowSettings(false)}>Leave settings</button>
          {showSettings && <SettingsKeyboardShortcutsSection />}
        </>
      );
    }
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        <ClientConnectionProvider connection={connection}>
          <Owner />
        </ClientConnectionProvider>,
      );
    });
    try {
      expect(applied.length).toBeGreaterThan(0);
      fireEvent.click(screen.getAllByRole("button", { name: /^Record shortcut for / })[0]!);
      await waitFor(() => expect(applied.at(-1)?.recording).toBe(true));
      if (cancel === "unmount")
        fireEvent.click(screen.getByRole("button", { name: "Leave settings" }));
      else fireEvent(window, new Event("blur"));
      await act(async () => {
        prepared.resolve();
        await prepared.promise;
      });
      expect(document.documentElement.hasAttribute("data-shortcut-recording")).toBe(false);
      expect(applied.at(-1)?.recording).toBe(false);
      expect(screen.queryByText("Press your shortcut. Escape cancels.")).toBeNull();
      expect(fireEvent.keyDown(window, { key: "b", ctrlKey: true })).toBe(false);
      expect(run).toHaveBeenCalledTimes(1);
    } finally {
      prepared.resolve();
      view.unmount();
      document.documentElement.removeAttribute("data-shortcut-recording");
    }
  },
);

test("native shortcuts activate only after the current installation acknowledges", async () => {
  const installations: {
    rules: ElectronShortcutRules;
    ready: ReturnType<typeof Promise.withResolvers<void>>;
  }[] = [];
  installNativeBridge((rules) => {
    const ready = Promise.withResolvers<void>();
    installations.push({ rules, ready });
    return ready.promise;
  });
  const connection = createTestClientConnection();
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const run = mock(() => {});
  function Owner() {
    const [settingsAvailable, setSettingsAvailable] = useState(false);
    const routing = useShortcutDispatch({
      platform: "darwin",
      pageCommands: [],
      actions: [
        {
          key: "action:settings",
          label: "Open Settings",
          workspaceName: null,
          icon: null,
          keywords: [],
          suggested: false,
          disabledReason: settingsAvailable ? null : "Unavailable",
          checked: false,
          run: () => {},
        },
        {
          key: "action:sidebar",
          label: "Toggle sidebar",
          workspaceName: null,
          icon: null,
          keywords: [],
          suggested: false,
          disabledReason: null,
          checked: false,
          run,
        },
      ],
      isOpen: false,
      open: () => {},
      close: () => {},
      runAfterClose: (operation) => operation(),
    });
    return (
      <>
        <output>{routing.labelForCommand("sidebar") ?? "Unavailable"}</output>
        <button onClick={() => setSettingsAvailable(true)}>Enable Settings command</button>
      </>
    );
  }
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <Owner />
    </ClientConnectionProvider>,
  );
  try {
    await waitFor(() => expect(installations.length).toBe(1));
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(fireEvent.keyDown(window, { key: "b", ctrlKey: true })).toBe(true);
    act(() =>
      connection.queryClient.setQueryData(["keyboard-shortcuts"], {
        version: 1,
        overrides: {
          sidebar: {
            key: { kind: "logical", key: "F9" },
            ctrl: true,
            meta: false,
            alt: false,
            shift: true,
          },
        },
      }),
    );
    await waitFor(() => expect(installations.length).toBe(2));
    await act(async () => {
      installations[0]!.ready.resolve();
      await installations[0]!.ready.promise;
    });
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(fireEvent.keyDown(window, { key: "F9", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(run).not.toHaveBeenCalled();
    await act(async () => {
      installations[1]!.ready.resolve();
      await installations[1]!.ready.promise;
    });
    await screen.findByText("Ctrl+Shift+F9");
    expect(fireEvent.keyDown(window, { key: "b", ctrlKey: true })).toBe(true);
    expect(fireEvent.keyDown(window, { key: "F9", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: "Meta", code: "MetaLeft", metaKey: true });
    expect(document.documentElement.hasAttribute("data-shortcut-hints")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Enable Settings command" }));
    await waitFor(() => expect(installations.length).toBe(3));
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(document.documentElement.hasAttribute("data-shortcut-hints")).toBe(true);
    await act(async () => {
      installations[2]!.ready.resolve();
      await installations[2]!.ready.promise;
    });
    expect(document.documentElement.hasAttribute("data-shortcut-hints")).toBe(true);
    fireEvent.keyUp(window, { key: "Meta", code: "MetaLeft" });
    expect(document.documentElement.hasAttribute("data-shortcut-hints")).toBe(false);
  } finally {
    view.unmount();
    installations.forEach(({ ready }) => ready.resolve());
  }
});

test("ordinary focus changes keep keyboard routing current without rendering the input owner", async () => {
  const connection = createTestClientConnection({ scheduleTask: () => () => {} });
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const open = mock(() => {});
  let renders = 0;
  function Owner() {
    renders++;
    useShortcutDispatch({
      platform: "darwin",
      pageCommands: [],
      actions: [],
      isOpen: false,
      open,
      close: () => {},
      runAfterClose: (run) => run(),
    });
    return (
      <>
        <button>First control</button>
        <button>Second control</button>
      </>
    );
  }
  const view = render(
    <ClientConnectionProvider connection={connection}>
      <Owner />
    </ClientConnectionProvider>,
  );
  await waitFor(() => expect(connection.queryClient.isFetching()).toBe(0));
  await act(async () => screen.getByRole("button", { name: "First control" }).focus());
  const before = renders;
  await act(async () => screen.getByRole("button", { name: "Second control" }).focus());
  expect(renders).toBe(before);
  fireEvent.keyDown(window, { key: "k", metaKey: true });
  expect(open).toHaveBeenCalledTimes(1);
  view.unmount();
  await connection.dispose();
});

test("saved workflow bindings stay inactive when the workflow is absent from the catalogue", () => {
  const connection = createTestClientConnection();
  const run = mock(() => {});
  const id = "workflow:unavailable-workflow:start" as const;
  connection.queryClient.setQueryData(["keyboard-shortcuts"], {
    version: 1,
    overrides: {
      [id]: {
        key: { kind: "logical", key: "f8" },
        ctrl: true,
        meta: false,
        alt: false,
        shift: false,
      },
    },
  });
  function Owner() {
    useShortcutDispatch({
      platform: "darwin",
      pageCommands: [
        { id, label: "Unavailable workflow action", icon: Command, keywords: [], run },
      ],
      actions: [],
      isOpen: false,
      open() {},
      close() {},
      runAfterClose(action) {
        action();
      },
    });
    return null;
  }
  render(
    <ClientConnectionProvider connection={connection}>
      <Owner />
    </ClientConnectionProvider>,
  );
  expect(fireEvent.keyDown(window, { key: "F8", code: "F8", ctrlKey: true })).toBe(true);
  expect(run).not.toHaveBeenCalled();
});
