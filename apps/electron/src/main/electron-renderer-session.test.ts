import { describe, expect, test } from "bun:test";
import {
  ELECTRON_RENDERER_SESSION_PARTITION,
  resolveElectronRendererSession,
} from "./electron-renderer-session";

describe("resolveElectronRendererSession", () => {
  test("uses a named persistent partition for renderer storage", () => {
    const calls: string[] = [];
    const rendererSession = { name: "renderer-session" };

    const resolved = resolveElectronRendererSession({
      fromPartition(partition) {
        calls.push(partition);
        return rendererSession;
      },
    });

    expect(resolved).toBe(rendererSession);
    expect(calls).toEqual([ELECTRON_RENDERER_SESSION_PARTITION]);
  });
});
