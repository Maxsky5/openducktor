import "@xterm/xterm/css/xterm.css";
import type { AppPlatform, TerminalLifecycle } from "@openducktor/contracts";
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { hostClient } from "@/lib/host-client";
import { stageLocalAttachmentFile } from "@/lib/local-attachment-files";
import { cn } from "@/lib/utils";
import {
  type InteractiveTerminalMount,
  mountInteractiveTerminal,
} from "./interactive-terminal-mount";
import type { TerminalTransportController } from "./terminal-transport-controller";

export function InteractiveTerminal({
  terminalId,
  controller,
  platform,
  active,
  focusRequest,
  onAttention,
  onLifecycle,
  onForgotten,
  onTitleChange,
}: {
  terminalId: string;
  controller: TerminalTransportController;
  platform: AppPlatform | undefined;
  active: boolean;
  focusRequest: number;
  onAttention: (message: string | null) => void;
  onLifecycle: (lifecycle: TerminalLifecycle, exitText: string | null) => void;
  onForgotten: (message: string) => void;
  onTitleChange: (title: string) => void;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountRef = useRef<InteractiveTerminalMount | null>(null);
  const platformRef = useRef(platform);
  const callbacksRef = useRef({ onAttention, onLifecycle, onForgotten, onTitleChange });
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const isActive = useEffectEvent(() => active);

  useEffect(() => {
    platformRef.current = platform;
  }, [platform]);

  useEffect(() => {
    callbacksRef.current = { onAttention, onLifecycle, onForgotten, onTitleChange };
  }, [onAttention, onForgotten, onLifecycle, onTitleChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setIsHydrated(false);
    setIsImageDragActive(false);
    setRendererError(null);
    const interactionToastId = `terminal:${terminalId}:interaction`;
    try {
      mountRef.current = mountInteractiveTerminal({
        container,
        terminalId,
        controller,
        isActive,
        getPlatform: () => platformRef.current,
        stageFile: stageLocalAttachmentFile,
        preparePathInput: async (paths) => {
          const response = await hostClient.terminalPreparePathInput({
            terminalId,
            paths: [...paths],
          });
          return response.text;
        },
        writeClipboard: (text) => navigator.clipboard.writeText(text),
        onAttention: (message) => callbacksRef.current.onAttention(message),
        onLifecycle: (lifecycle, exitText) => callbacksRef.current.onLifecycle(lifecycle, exitText),
        onForgotten: (message) => callbacksRef.current.onForgotten(message),
        onTitleChange: (title) => callbacksRef.current.onTitleChange(title),
        onHydrated: () => setIsHydrated(true),
        onImageDragActiveChange: setIsImageDragActive,
        onRendererError: setRendererError,
        onInteractionFailure: (title, cause) => {
          toast.error(title, { id: interactionToastId, description: errorMessage(cause) });
        },
      });
    } catch (cause) {
      setRendererError(errorMessage(cause));
    }
    return () => {
      mountRef.current?.dispose();
      mountRef.current = null;
      toast.dismiss(interactionToastId);
    };
  }, [controller, terminalId]);

  useEffect(() => {
    if (!active || !isHydrated) return;
    const frameId = requestAnimationFrame(() => mountRef.current?.activate(focusRequest > 0));
    return () => cancelAnimationFrame(frameId);
  }, [active, focusRequest, isHydrated]);

  return (
    <div className="relative h-full min-h-0 bg-[var(--dev-server-terminal-panel)]">
      <div
        ref={containerRef}
        className={cn("h-full min-h-0 px-2 py-1", (!isHydrated || rendererError) && "invisible")}
        role="application"
        aria-label={`Interactive terminal ${terminalId}`}
      />
      {isImageDragActive ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-md border border-dashed border-primary bg-background/90 text-sm font-medium text-foreground"
        >
          Drop image to paste its path
        </div>
      ) : null}
      {rendererError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--dev-server-terminal-panel)] p-6">
          <div role="alert" className="flex max-w-md flex-col items-center gap-2 text-center">
            <p className="text-sm font-semibold text-foreground">Terminal renderer unavailable</p>
            <p className="text-xs text-muted-foreground">
              {rendererError} Close and reopen this terminal tab.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
