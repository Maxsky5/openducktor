import type {
  ElectronShortcutRules,
  EmbeddedShortcutEvent,
  ShortcutRoute,
} from "@openducktor/contracts";
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { getShellBridge } from "@/lib/shell-bridge";
import type { EmbeddedShortcutListener } from "./embedded-sources";

export type NativeShortcutRoutes = {
  claims: readonly string[];
  guestRoutes: Readonly<Record<string, readonly ShortcutRoute[]>>;
};

/**
 * Installs the Electron window rules: the claimed signatures, the routes of each browser guest,
 * and recording mode. Renderer dispatch does not wait for main; only guest invocations must come
 * from the current rules.
 */
export function useNativeShortcutRouting({
  enabled,
  routesVersion,
  readRoutes,
  recording,
  retryRevision,
  onInput,
}: {
  enabled: boolean;
  /** Changes whenever the routes can change. */
  routesVersion: unknown;
  /** Reads the routes after a commit; they come from the browser tabs in the DOM. */
  readRoutes(): NativeShortcutRoutes;
  recording: boolean;
  retryRevision: number;
  onInput: EmbeddedShortcutListener;
}) {
  const bridge = enabled ? getShellBridge().shortcuts : undefined;
  const control = useRef({ alive: false, revision: 0, acknowledged: -1, installed: "" });
  const [error, setError] = useState<string | null>(null);
  const apply = useCallback(
    async (next: NativeShortcutRoutes, active: boolean): Promise<void> => {
      if (!bridge) throw new Error("The desktop shortcut bridge is unavailable. Restart the app.");
      const owner = control.current;
      const rules: ElectronShortcutRules = {
        revision: ++owner.revision,
        recording: active,
        claims: [...next.claims],
        guestRoutes: Object.fromEntries(
          Object.entries(next.guestRoutes).map(([tabId, list]) => [tabId, [...list]]),
        ),
      };
      owner.installed = JSON.stringify([next, active]);
      try {
        await bridge.apply(rules);
        if (owner.alive && owner.revision === rules.revision) {
          owner.acknowledged = rules.revision;
          setError(null);
        }
      } catch (cause) {
        owner.installed = "";
        const message = cause instanceof Error ? cause.message : String(cause);
        if (owner.alive && owner.revision === rules.revision) setError(message);
        throw new Error(message);
      }
    },
    [bridge],
  );
  const receive = useEffectEvent(
    (message: { sourceTabId: string | null; event: EmbeddedShortcutEvent }) => {
      const owner = control.current;
      const { event, sourceTabId } = message;
      if (!owner.alive) return;
      const current = owner.acknowledged === owner.revision;
      if (event.type === "invoke" && (!current || event.revision !== owner.revision)) return;
      onInput(sourceTabId, event, current);
    },
  );
  useEffect(() => {
    if (!bridge) return;
    const owner = control.current;
    owner.alive = true;
    const release = bridge.subscribe(receive);
    return () => {
      owner.alive = false;
      owner.revision++;
      owner.installed = "";
      release();
      bridge.release();
    };
  }, [bridge]);
  const latest = useRef(readRoutes);
  useLayoutEffect(() => {
    latest.current = readRoutes;
  });
  const lastRetry = useRef(retryRevision);
  useEffect(() => {
    if (!enabled) return;
    const force = lastRetry.current !== retryRevision;
    lastRetry.current = retryRevision;
    const routes = latest.current();
    if (!force && control.current.installed === JSON.stringify([routes, recording])) return;
    apply(routes, recording).catch(() => {});
  }, [enabled, routesVersion, recording, retryRevision, apply]);
  return {
    error: enabled ? error : null,
    /** Installs recording mode now and resolves once main uses it. */
    prepareRecording: useCallback(
      (active: boolean) => (enabled ? apply(latest.current(), active) : Promise.resolve()),
      [enabled, apply],
    ),
  };
}
