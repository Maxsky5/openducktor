import type { ElectronShortcutRules, EmbeddedShortcutEvent } from "@openducktor/contracts";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { EmbeddedShortcutListener } from "./embedded-sources";
import { getShellBridge } from "@/lib/shell-bridge";

export type NativeShortcutRoutes = Omit<ElectronShortcutRules, "revision" | "recording">;
/** Owns native subscriptions, acknowledgements and recording-mode installation. */
export function useNativeShortcutRouting({
  enabled,
  retryRevision,
  routesVersion,
  readRoutes,
  recording,
  onInput,
}: {
  enabled: boolean;
  retryRevision: number;
  routesVersion: object;
  readRoutes(): NativeShortcutRoutes;
  recording: RefObject<boolean>;
  onInput: EmbeddedShortcutListener;
}) {
  const bridge = enabled ? getShellBridge().shortcuts : undefined;
  const control = useRef<{
    alive: boolean;
    revision: number;
    acknowledged: number | null;
    rules: ElectronShortcutRules | null;
  }>({ alive: false, revision: 0, acknowledged: null, rules: null });
  const [status, setStatus] = useState<{ ready: boolean; error: string | null }>({
    ready: false,
    error: null,
  });
  const apply = useCallback(
    async (routes: NativeShortcutRoutes, active: boolean) => {
      const owner = control.current;
      const rules = { ...routes, revision: ++owner.revision, recording: active };
      owner.rules = rules;
      owner.acknowledged = null;
      if (!bridge) {
        const error = "The desktop shortcut bridge is unavailable. Restart the app.";
        setStatus({ ready: false, error });
        return error;
      }
      setStatus((previous) => (previous.ready ? { ...previous, ready: false } : previous));
      try {
        await bridge.apply(rules);
        if (owner.alive && owner.revision === rules.revision) {
          owner.acknowledged = rules.revision;
          setStatus({ ready: true, error: null });
        }
        return null;
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        if (owner.alive && owner.revision === rules.revision) setStatus({ ready: false, error });
        return error;
      }
    },
    [bridge],
  );
  const receive = useEffectEvent(
    (message: { sourceTabId: string | null; event: EmbeddedShortcutEvent }) => {
      const owner = control.current;
      const { event, sourceTabId } = message;
      if (!owner.alive) return;
      if (event.type === "blur") recording.current = false;
      const ready = owner.acknowledged === owner.revision;
      if (event.type === "invoke" && (!ready || event.revision !== owner.revision)) return;
      onInput(sourceTabId, event, ready);
    },
  );
  useEffect(() => {
    const owner = control.current;
    owner.alive = true;
    const release = bridge?.subscribe(receive);
    return () => {
      owner.alive = false;
      owner.revision++;
      owner.acknowledged = null;
      owner.rules = null;
      release?.();
      bridge?.release();
    };
  }, [bridge]);
  const readRoutesRef = useRef(readRoutes);
  useLayoutEffect(() => {
    readRoutesRef.current = readRoutes;
  });
  const install = useCallback(
    (force: boolean) => {
      if (!enabled) return;
      const routes = readRoutesRef.current();
      const previous = control.current.rules;
      if (
        !force &&
        previous &&
        JSON.stringify([
          previous.suppressMenuFor,
          previous.guestRoutes,
          previous.reservePanelCloseModW,
          previous.recording,
        ]) ===
          JSON.stringify([
            routes.suppressMenuFor,
            routes.guestRoutes,
            routes.reservePanelCloseModW,
            recording.current,
          ])
      )
        return;
      void apply(routes, recording.current);
    },
    [enabled, apply, recording],
  );
  const lastRetry = useRef(retryRevision);
  useEffect(() => {
    const force = lastRetry.current !== retryRevision;
    lastRetry.current = retryRevision;
    install(force);
  }, [routesVersion, retryRevision, install]);
  const prepareRecording = useCallback(
    async (active: boolean) => {
      if (!enabled) return;
      const rules = control.current.rules;
      if (!rules) throw new Error("Desktop shortcut routing is unavailable. Restart the app.");
      const error = await apply(rules, active);
      if (error) throw new Error(error);
    },
    [enabled, apply],
  );
  return {
    get ready() {
      return !enabled || control.current.acknowledged === control.current.revision;
    },
    error: enabled ? status.error : null,
    get reservePanelCloseModW() {
      return control.current.rules?.reservePanelCloseModW ?? false;
    },
    refresh: () => install(false),
    prepareRecording,
  };
}
