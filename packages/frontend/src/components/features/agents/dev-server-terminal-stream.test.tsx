import { describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { DevServerTerminalChunk } from "@openducktor/contracts";
import { act, render } from "@testing-library/react";
import { type ReactElement, Suspense, startTransition } from "react";
import {
  appendDevServerTerminalChunk,
  createDevServerTerminalBufferStore,
  getDevServerTerminalBuffer,
  replaceDevServerTerminalBuffer,
} from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import { AgentStudioDevServerTerminal } from "./agent-studio-dev-server-terminal";

if (globalThis.document === undefined) GlobalRegistrator.register();

const chunk = (sequence: number): DevServerTerminalChunk => ({
  scriptId: "frontend",
  runIdentity: { runId: "run", runOrder: { hostInstanceId: "host", generation: 1 } },
  sequence,
  data: `${sequence},`,
  timestamp: "2026-03-25T10:00:00.000Z",
});

const suspendedRender = new Promise<void>(() => {});
const TerminalRenderGate = ({
  suspend,
  children,
}: {
  suspend: boolean;
  children: ReactElement;
}) => {
  if (suspend) throw suspendedRender;
  return children;
};

const createStreamHarness = async (initialChunks = [chunk(0)]) => {
  const store = createDevServerTerminalBufferStore();
  let screen = "";
  const writes: string[] = [];
  let resets = 0;
  const createTerminalBinding = () => ({
    terminal: {
      options: {},
      open: () => {},
      loadAddon: () => {},
      dispose: () => {},
      clear: () => {
        screen = "";
      },
      reset: () => {
        resets += 1;
        screen = "";
      },
      write: (data: string) => {
        writes.push(data);
        screen += data;
      },
    },
    fitAddon: { fit: () => {}, dispose: () => {} },
  });
  const onRendererError = (message: string | null) => {
    if (message) throw new Error(message);
  };
  const element = (suspend = false) => (
    <Suspense fallback={null}>
      <TerminalRenderGate suspend={suspend}>
        <AgentStudioDevServerTerminal
          scopeKey="task"
          scriptId="frontend"
          terminalBuffer={getDevServerTerminalBuffer(store, "frontend")}
          createTerminalBinding={createTerminalBinding}
          onRendererError={onRendererError}
        />
      </TerminalRenderGate>
    </Suspense>
  );
  replaceDevServerTerminalBuffer(store, "frontend", initialChunks);
  const view = render(element());
  await act(async () => {});
  return {
    store,
    writes,
    screen: () => screen,
    resets: () => resets,
    publish: async (suspend = false) => {
      await act(async () => {
        startTransition(() => {
          view.rerender(element(suspend));
        });
      });
    },
    unmount: view.unmount,
  };
};

describe("dev server terminal stream", () => {
  test("renders retained bursts and sequence gaps in order exactly once", async () => {
    const harness = await createStreamHarness();
    try {
      for (let sequence = 3; sequence <= 300; sequence += 3) {
        appendDevServerTerminalChunk(harness.store, chunk(sequence));
      }
      await harness.publish();
      await harness.publish();
      expect(harness.writes).toHaveLength(2);
      expect(harness.screen()).toBe(
        Array.from({ length: 101 }, (_, index) => `${index * 3},`).join(""),
      );
      expect(harness.resets()).toBe(1);
      // Several publications can pass before the terminal renders again.
      for (let sequence = 303; sequence <= 600; sequence += 3) {
        appendDevServerTerminalChunk(harness.store, chunk(sequence));
        if (sequence === 450) getDevServerTerminalBuffer(harness.store, "frontend");
      }
      await harness.publish();
      expect(harness.screen()).toBe(
        Array.from({ length: 201 }, (_, index) => `${index * 3},`).join(""),
      );
      expect(harness.writes).toHaveLength(3);
    } finally {
      harness.unmount();
    }
  });

  test("keeps committed output while snapshots suspend and catches up on resume", async () => {
    const harness = await createStreamHarness();
    try {
      appendDevServerTerminalChunk(harness.store, chunk(1));
      await harness.publish(true);
      expect(harness.screen()).toBe("0,");
      appendDevServerTerminalChunk(harness.store, chunk(2));
      await harness.publish(true);
      expect(harness.screen()).toBe("0,");
      await harness.publish();
      expect(harness.screen()).toBe("0,1,2,");
      expect(harness.writes).toEqual(["0,", "1,2,"]);
      expect(harness.resets()).toBe(1);
    } finally {
      harness.unmount();
    }
  });

  test("reports overflow when an empty terminal waits for its first publication", async () => {
    const harness = await createStreamHarness([]);
    try {
      for (let sequence = 0; sequence <= 2_000; sequence += 1) {
        appendDevServerTerminalChunk(harness.store, chunk(sequence));
      }
      await harness.publish();
      expect(harness.screen()).toStartWith("[Dev server output exceeded the 2,000-chunk buffer.");
      expect(harness.screen()).toEndWith("1999,2000,");
    } finally {
      harness.unmount();
    }
  });

  test("shows retention loss after rendering pauses and resumes exactly once", async () => {
    const harness = await createStreamHarness();
    try {
      for (let sequence = 1; sequence <= 2_001; sequence += 1) {
        appendDevServerTerminalChunk(harness.store, chunk(sequence));
      }
      await harness.publish();
      expect(harness.screen()).toBe(
        "[Dev server output exceeded the 2,000-chunk buffer. Showing retained output.]\r\n" +
          Array.from({ length: 2_000 }, (_, index) => `${index + 2},`).join(""),
      );
      expect(harness.resets()).toBe(2);
      appendDevServerTerminalChunk(harness.store, chunk(2_004));
      await harness.publish();
      expect(harness.writes.at(-1)).toBe("2004,");
      expect(harness.resets()).toBe(2);
      replaceDevServerTerminalBuffer(harness.store, "frontend", [chunk(0)]);
      await harness.publish();
      expect(harness.screen()).toBe("0,");
      expect(harness.resets()).toBe(3);
    } finally {
      harness.unmount();
    }
  });

  test("does not flag loss when the last rendered entry itself was evicted", async () => {
    const harness = await createStreamHarness();
    try {
      for (let sequence = 1; sequence <= 2_000; sequence += 1) {
        appendDevServerTerminalChunk(harness.store, chunk(sequence));
      }
      await harness.publish();
      expect(harness.resets()).toBe(1);
      expect(harness.screen()).toBe(
        Array.from({ length: 2_001 }, (_, index) => `${index},`).join(""),
      );
    } finally {
      harness.unmount();
    }
  });
});
