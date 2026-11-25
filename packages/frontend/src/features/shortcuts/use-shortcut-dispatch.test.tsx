import { afterEach, expect, mock, spyOn, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  ElectronShortcutBridge,
  ElectronShortcutRules,
  EmbeddedShortcutRules,
  EmbeddedShortcutEvent,
  ShortcutInput,
  ShortcutPreferences,
} from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { createUnavailableShellBridge, type ShellBridge } from "@/lib/shell-bridge";
import { ShellPlatformContext } from "@/lib/shell-platform";
import { ShortcutTestProviders } from "@/test-utils/shortcut-providers";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";
import type { CommandPaletteCommandRegistration } from "../command-palette/command-palette-types";
import { embeddedShortcutSources } from "./embedded-sources";
import { shortcutRecording } from "./recording-store";
import { useShortcutDispatch } from "./use-shortcut-dispatch";
import { useShortcutLabel } from "./use-shortcut-label";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-shortcut-hints");
});

type NativeListener = Parameters<ElectronShortcutBridge["subscribe"]>[0];
function createNativeBridge(apply: ElectronShortcutBridge["apply"]) {
  const ignore: NativeListener = () => {};
  const native = { input: ignore };
  const shellPlatform: ShellBridge = {
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
      subscribe: (listener) => {
        native.input = listener;
        return () => {};
      },
      release: () => {},
    },
  };
  return { native, shellPlatform };
}

const visible = (element: Element) =>
  spyOn(element, "getClientRects").mockReturnValue({
    0: new DOMRect(),
    length: 1,
    item: () => new DOMRect(),
    [Symbol.iterator]: () => [new DOMRect()][Symbol.iterator](),
  });
const keyInput = (overrides: Partial<ShortcutInput>): ShortcutInput => ({
  phase: "down",
  key: "w",
  code: "KeyW",
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  repeat: false,
  composing: false,
  ...overrides,
});

function renderOwner({
  platform = "linux",
  shellPlatform = createUnavailableShellBridge(),
  commands,
  overrides = {},
  when,
  children,
}: {
  platform?: "darwin" | "linux";
  shellPlatform?: ShellBridge;
  commands: readonly CommandPaletteCommandRegistration[];
  overrides?: ShortcutPreferences["overrides"];
  when?: ShortcutPreferences["when"];
  children?: React.ReactNode;
}) {
  const connection = createTestClientConnection();
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides, when });
  function Owner() {
    useCommandPalettePageCommands(commands);
    const routing = useShortcutDispatch({
      platform,
      isOpen: false,
      open: () => {},
      close: () => {},
      runAfterClose: (run) => run(),
    });
    const label = useShortcutLabel("sidebar");
    return (
      <>
        <output data-testid="routing-error">{routing.inputError ?? "Ready"}</output>
        <output data-testid="sidebar-label">{label ?? "Unavailable"}</output>
        <button type="button" onClick={routing.retry}>
          Retry routes
        </button>
        {children}
      </>
    );
  }
  return render(
    <ShellPlatformContext value={shellPlatform}>
      <ShortcutTestProviders connection={connection}>
        <Owner />
      </ShortcutTestProviders>
    </ShellPlatformContext>,
  );
}

test("runs the registered owner of the pressed keys and leaves other keys to the page", () => {
  const toggle = mock(() => {});
  renderOwner({ commands: [{ id: "sidebar", run: toggle, appWide: true, localOnly: true }] });
  expect(fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true })).toBe(false);
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(fireEvent.keyDown(window, { key: "j", code: "KeyJ", ctrlKey: true })).toBe(true);
  expect(screen.getByTestId("sidebar-label").textContent).toBe("Ctrl+B");
});

test("an assignment that cannot run on this device turns off only itself", () => {
  const toggle = mock(() => {});
  const diagnostics = mock(() => {});
  renderOwner({
    commands: [
      { id: "sidebar", run: toggle, appWide: true, localOnly: true },
      { id: "diagnostics", run: diagnostics, appWide: true, localOnly: true },
    ],
    // Mod+B is Control+B here, which Toggle sidebar keeps.
    overrides: {
      diagnostics: {
        key: { kind: "logical", key: "b" },
        mod: true,
        ctrl: false,
        alt: false,
        shift: false,
      },
    },
  });
  fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(diagnostics).not.toHaveBeenCalled();
  expect(screen.getByTestId("routing-error").textContent).toBe("Ready");
});

test("saved workflow bindings stay inactive when the workflow is absent from the catalogue", () => {
  const run = mock(() => {});
  const id = "workflow:unavailable-workflow:start" as const;
  renderOwner({
    commands: [{ id, label: "Unavailable workflow action", run }],
    overrides: {
      [id]: {
        key: { kind: "logical", key: "f8" },
        mod: true,
        ctrl: false,
        alt: false,
        shift: false,
      },
    },
  });
  expect(fireEvent.keyDown(window, { key: "F8", code: "F8", ctrlKey: true })).toBe(true);
  expect(run).not.toHaveBeenCalled();
});

test("Electron claims every assignment once and renderer keys do not wait for main", async () => {
  const applied: ElectronShortcutRules[] = [];
  const { shellPlatform } = createNativeBridge((rules) => {
    applied.push(rules);
    return new Promise(() => {});
  });
  const toggle = mock(() => {});
  renderOwner({
    shellPlatform,
    platform: "darwin",
    commands: [{ id: "sidebar", run: toggle, appWide: true, localOnly: true }],
    children: (
      <>
        <button type="button">First</button>
        <button type="button">Second</button>
      </>
    ),
  });
  await waitFor(() => expect(applied).toHaveLength(1));
  expect(applied[0]!.claims).toContain("meta:k");
  expect(applied[0]!.claims).toContain("ctrl:b");
  act(() => screen.getByRole("button", { name: "First" }).focus());
  act(() => screen.getByRole("button", { name: "Second" }).focus());
  fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
  expect(toggle).toHaveBeenCalledTimes(1);
  expect(applied).toHaveLength(1);
});

test("guest routes belong to each tab and only current rules can invoke", async () => {
  const applied: ElectronShortcutRules[] = [];
  const { native, shellPlatform } = createNativeBridge(async (rules) => {
    applied.push(rules);
  });
  const root = document.createElement("div");
  root.setAttribute("data-browser-tab-id", "guest");
  document.body.append(root);
  const rects = visible(root);
  const close = mock(() => {});
  try {
    renderOwner({
      shellPlatform,
      platform: "darwin",
      commands: [
        {
          id: "close-panel-tab",
          target: { kind: "panel", key: "panel" },
          focusRoot: () => root,
          run: close,
        },
      ],
    });
    act(() => native.input({ sourceTabId: "guest", event: { type: "focus" } }));
    await waitFor(() =>
      expect(applied.at(-1)?.guestRoutes.guest?.map((route) => route.signature)).toContain(
        "meta:w",
      ),
    );
    const invoke = (revision: number): EmbeddedShortcutEvent => ({
      type: "invoke",
      revision,
      commandId: "close-panel-tab",
      input: keyInput({ meta: true }),
    });
    act(() => native.input({ sourceTabId: "guest", event: invoke(applied.at(-1)!.revision - 1) }));
    expect(close).not.toHaveBeenCalled();
    act(() => native.input({ sourceTabId: "guest", event: invoke(applied.at(-1)!.revision) }));
    expect(close).toHaveBeenCalledTimes(1);
  } finally {
    root.remove();
    rects.mockRestore();
  }
});

test("recording installs Electron recording mode and stops app shortcuts", async () => {
  const applied: ElectronShortcutRules[] = [];
  const { shellPlatform } = createNativeBridge(async (rules) => {
    applied.push(rules);
  });
  const toggle = mock(() => {});
  renderOwner({
    shellPlatform,
    commands: [{ id: "sidebar", run: toggle, appWide: true, localOnly: true }],
  });
  await act(() => shortcutRecording.begin());
  expect(applied.at(-1)?.recording).toBe(true);
  fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
  expect(toggle).not.toHaveBeenCalled();
  await act(() => shortcutRecording.end());
  expect(applied.at(-1)?.recording).toBe(false);
  fireEvent.keyDown(window, { key: "b", code: "KeyB", ctrlKey: true });
  expect(toggle).toHaveBeenCalledTimes(1);
});

test("a preview page reaches only commands that run while typing by default", async () => {
  const applied: EmbeddedShortcutRules[] = [];
  const source = {
    tabId: "page",
    apply: mock(async (rules: EmbeddedShortcutRules) => {
      applied.push(rules);
    }),
  };
  const release = embeddedShortcutSources.register(source);
  const toggle = mock(() => {});
  const diagnostics = mock(() => {});
  try {
    renderOwner({
      commands: [
        { id: "sidebar", run: toggle, appWide: true, localOnly: true },
        { id: "diagnostics", run: diagnostics, appWide: true, localOnly: true },
      ],
      overrides: {
        diagnostics: {
          key: { kind: "logical", key: "j" },
          mod: false,
          ctrl: true,
          alt: false,
          shift: false,
        },
      },
      // The user lets Open diagnostics run while typing; a page still must not start it.
      when: { diagnostics: "always" },
      children: <div data-browser-tab-id="page" />,
    });
    const rects = visible(document.querySelector('[data-browser-tab-id="page"]')!);
    try {
      fireEvent.click(screen.getByRole("button", { name: "Retry routes" }));
      await waitFor(() =>
        expect(applied.at(-1)?.routes.map((route) => route.commandId)).toContain("sidebar"),
      );
      expect(applied.at(-1)?.routes.map((route) => route.commandId)).not.toContain("diagnostics");
      const invoke = (commandId: "sidebar" | "diagnostics", key: string) =>
        embeddedShortcutSources.report(source, {
          type: "invoke",
          revision: applied.at(-1)!.revision,
          commandId,
          input: keyInput({ key, code: `Key${key.toUpperCase()}`, ctrl: true }),
        });
      act(() => invoke("diagnostics", "j"));
      expect(diagnostics).not.toHaveBeenCalled();
      act(() => invoke("sidebar", "b"));
      expect(toggle).toHaveBeenCalledTimes(1);
    } finally {
      rects.mockRestore();
    }
  } finally {
    cleanup();
    release();
  }
});

test("keeps preview failures per source and hides labels in a frame without routes", async () => {
  const failing = Promise.withResolvers<void>();
  const first = { tabId: "failing", apply: mock(() => failing.promise) };
  const second = { tabId: "healthy", apply: mock(async () => {}) };
  const releaseFirst = embeddedShortcutSources.register(first);
  const releaseSecond = embeddedShortcutSources.register(second);
  try {
    renderOwner({
      commands: [{ id: "sidebar", run: () => {}, appWide: true, localOnly: true }],
      children: (
        <>
          <iframe srcDoc="" title="Failed page" data-browser-frame-tab-id="failing" />
          <iframe srcDoc="" title="Healthy page" data-browser-frame-tab-id="healthy" />
        </>
      ),
    });
    act(() => screen.getByTitle("Failed page").focus());
    expect(screen.getByTestId("sidebar-label").textContent).toBe("Unavailable");
    await act(async () => {
      failing.reject(new Error("First preview rejected routes."));
      await failing.promise.catch(() => {});
    });
    await waitFor(() =>
      expect(screen.getByTestId("routing-error").textContent).toBe(
        "Some keyboard shortcuts are unavailable. First preview rejected routes.",
      ),
    );
    act(() =>
      embeddedShortcutSources.report(first, {
        type: "key-state",
        input: keyInput({ key: "Control", code: "ControlLeft", ctrl: true }),
      }),
    );
    expect(document.documentElement.hasAttribute("data-shortcut-hints")).toBe(false);
    act(() => screen.getByTitle("Healthy page").focus());
    await waitFor(() => expect(screen.getByTestId("sidebar-label").textContent).toBe("Ctrl+B"));
    first.apply.mockImplementation(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry routes" }));
    });
    await waitFor(() => expect(screen.getByTestId("routing-error").textContent).toBe("Ready"));
    act(() => screen.getByTitle("Failed page").focus());
    expect(screen.getByTestId("sidebar-label").textContent).toBe("Ctrl+B");
  } finally {
    cleanup();
    releaseFirst();
    releaseSecond();
  }
});
