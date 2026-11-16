import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { AppPlatform, ShortcutActionId, ShortcutCombination } from "@openducktor/contracts";
import { recordShortcut } from "@openducktor/contracts";
import { modifierKeyParts } from "@openducktor/frontend-core/shortcuts/key-labels";
import { shortcutInputFromEvent } from "./dom-input";
import { shortcutRecording } from "./recording-store";

/** Owns native preparation, capture, cancellation, cleanup, and recording focus restoration. */
export function useShortcutRecorder({
  platform,
  onRecorded,
  onError,
}: {
  platform: AppPlatform;
  onRecorded(id: ShortcutActionId, combination: ShortcutCombination): void;
  onError(message: string): void;
}) {
  const [status, setStatus] = useState<{ recording: ShortcutActionId | null; preparing: boolean }>({
    recording: null,
    preparing: false,
  });
  /** The modifiers held now, and a key pressed without one, so the recorder shows it listens. */
  const [keys, setKeys] = useState<{ held: string[]; ignored: string | null }>({
    held: [],
    ignored: null,
  });
  const lifetime = useRef<{
    mounted: boolean;
    request: { id: ShortcutActionId; opener: HTMLElement } | null;
  }>({ mounted: true, request: null });
  const restoreFocus = useRef<HTMLElement | null>(null);
  const recorded = useEffectEvent(onRecorded);
  const reportFailure = useRef(onError);
  useLayoutEffect(() => {
    reportFailure.current = onError;
  });
  useLayoutEffect(() => {
    if (status.preparing || !restoreFocus.current) return;
    restoreFocus.current.focus();
    restoreFocus.current = null;
  }, [status]);
  /** `returnFocus` is false after a capture: the proposal that shows next takes focus. */
  const cancel = useCallback(async (returnFocus = true) => {
    const request = lifetime.current.request;
    if (!request) return;
    lifetime.current.request = null;
    setStatus({ recording: null, preparing: true });
    try {
      await shortcutRecording.end();
    } catch (cause) {
      if (lifetime.current.mounted)
        reportFailure.current(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (lifetime.current.mounted) {
        if (returnFocus) restoreFocus.current = request.opener;
        setStatus({ recording: null, preparing: false });
      }
    }
  }, []);
  const begin = useCallback(
    async (id: ShortcutActionId, opener: HTMLElement) => {
      const request = { id, opener };
      lifetime.current.request = request;
      setStatus({ recording: id, preparing: true });
      try {
        await shortcutRecording.begin();
      } catch (cause) {
        if (!lifetime.current.mounted || lifetime.current.request !== request) return;
        reportFailure.current(cause instanceof Error ? cause.message : String(cause));
        await cancel();
      } finally {
        if (lifetime.current.mounted && lifetime.current.request === request)
          setStatus({ recording: id, preparing: false });
      }
    },
    [cancel],
  );
  useEffect(() => {
    const owner = lifetime.current;
    owner.mounted = true;
    const blur = () => void cancel(true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      owner.mounted = false;
      if (!owner.request) return;
      owner.request = null;
      void shortcutRecording
        .end()
        .catch((cause) => console.error("Could not end shortcut recording.", cause));
    };
  }, [cancel]);
  useLayoutEffect(() => {
    if (!status.recording || status.preparing) return;
    const onKey = (event: KeyboardEvent) => {
      const request = lifetime.current.request;
      if (!request) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === "Escape") {
        void cancel();
        return;
      }
      const input = shortcutInputFromEvent(event);
      const held = modifierKeyParts(input, platform);
      const combination = event.type === "keydown" ? recordShortcut(input, platform) : null;
      if (!combination) {
        const modifierOnly = MODIFIER_KEYS.has(event.key);
        setKeys((current) => {
          const ignored =
            event.type === "keydown" && !modifierOnly && held.length === 0
              ? keyName(event.key)
              : modifierOnly
                ? current.ignored
                : null;
          // Key repeats and key releases often change nothing; keep the state so nothing renders.
          const same =
            ignored === current.ignored &&
            held.length === current.held.length &&
            held.every((key, index) => key === current.held[index]);
          return same ? current : { held, ignored };
        });
        return;
      }
      setKeys({ held: [], ignored: null });
      recorded(request.id, combination);
      void cancel(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      setKeys({ held: [], ignored: null });
    };
  }, [status, platform, cancel]);
  return { ...status, ...keys, begin, cancel };
}

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "AltGraph", "Shift"]);

/** A key as people name it: "Space", "D", or a named key such as "Tab". */
const keyName = (key: string): string =>
  key === " " ? "Space" : Array.from(key).length === 1 ? key.toUpperCase() : key;

/** True when a key types text by itself, so the hint can say why it is not a shortcut. */
export const typesText = (name: string): boolean =>
  name === "Space" || Array.from(name).length === 1;
