import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { AppPlatform, ShortcutActionId, ShortcutCombination } from "@openducktor/contracts";
import { recordShortcut } from "@openducktor/contracts";
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
  const cancel = useCallback(async () => {
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
        restoreFocus.current = request.opener;
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
    const blur = () => void cancel();
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
      const combination = recordShortcut(shortcutInputFromEvent(event), platform);
      if (!combination) return;
      recorded(request.id, combination);
      void cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [status, platform, cancel]);
  return { ...status, begin, cancel };
}
