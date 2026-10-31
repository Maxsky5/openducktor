import "@xterm/xterm/css/xterm.css";
import { type ReactElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStartupTerminalOutput } from "@openducktor/frontend-core/terminals/use-startup-terminal-output";
import { createTerminalOutputSequencer } from "@openducktor/frontend-core/terminals/terminal-output-sequencer";
import { restoreTerminalPrecedingJoinState } from "@openducktor/frontend-core/terminals/terminal-rep-state";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { getShellBridge } from "@/lib/shell-bridge";
import {
  createTerminalBinding,
  type TerminalBinding,
} from "@/features/terminals/shared-terminal-binding";
import { createTerminalOptions } from "@/features/terminals/terminal-xterm-options";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { StartupPresentation } from "./startup-presentation";

export function StartupActionOutput({
  terminalId,
  presentation,
}: {
  terminalId: string;
  presentation: StartupPresentation;
}): ReactElement {
  const { controller, transportError } = useStartupTerminalOutput(getShellBridge().terminals);
  const container = useRef<HTMLDivElement>(null);
  const bindingRef = useRef<TerminalBinding | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [textOutput, setTextOutput] = useState<string | null>(
    () => presentation.terminalText.get(terminalId) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const readingText = textOutput !== null;
  useLayoutEffect(() => {
    if (textRef.current)
      textRef.current.scrollTop = presentation.terminalTextScroll.get(terminalId) ?? 0;
  }, [presentation, terminalId, readingText]);

  useEffect(() => {
    if (!container.current || !controller) return;
    const element = container.current;
    let disposed = false;
    const report = (cause: unknown) => {
      if (!disposed) setError(errorMessage(cause));
    };
    let binding: TerminalBinding;
    try {
      binding = createTerminalBinding(
        element,
        createTerminalOptions(element, {
          disableStdin: true,
          cursorBlink: false,
          screenReaderMode: false,
          scrollOnUserInput: false,
        }),
      );
    } catch (cause) {
      report(cause);
      return;
    }
    bindingRef.current = binding;
    const { terminal } = binding;
    if (terminal.textarea) terminal.textarea.tabIndex = -1;
    let hydrated = false;
    const rememberPosition = () => {
      if (!hydrated) return;
      const buffer = terminal.buffer.active;
      presentation.terminalScroll.set(terminalId, buffer.viewportY);
      presentation.terminalFollowBottom.set(terminalId, buffer.viewportY === buffer.baseY);
    };
    const scrollSubscription = terminal.onScroll(rememberPosition);
    const sequencer = createTerminalOutputSequencer({
      write: (bytes, parsed) => terminal.write(bytes, parsed),
      onConsumed: (sequenceEnd) => {
        if (!disposed) void controller.acknowledge(terminalId, sequenceEnd).catch(report);
      },
      onHydrated: () => {
        const position = presentation.terminalScroll.get(terminalId);
        if (presentation.terminalFollowBottom.get(terminalId)) terminal.scrollToBottom();
        else if (position !== undefined) terminal.scrollToLine(position);
        hydrated = true;
        rememberPosition();
      },
    });
    // Ignore OSC clipboard writes. Copy remains available through the browser's selection.
    const clipboard = terminal.parser.registerOscHandler(52, () => true);
    const unsubscribe = controller.subscribe(terminalId, (message, payload) => {
      if (message.type === "snapshot") sequencer.setSnapshotBoundary(message.snapshotSequenceEnd);
      if (message.type === "screen_restore") {
        void sequencer
          .restore(
            message.sequenceEnd,
            payload,
            () => {
              terminal.reset();
              terminal.resize(message.columns, message.rows);
            },
            (complete) => {
              if (complete) restoreTerminalPrecedingJoinState(terminal, message.precedingJoinState);
            },
          )
          .catch(report);
      } else if (message.type === "protocol_error") {
        setError(message.failure.message);
      } else if (message.type === "terminal_forgotten") {
        setError("This terminal's output is no longer available.");
      } else if (message.type === "output") {
        void sequencer.enqueue(message, payload).catch(report);
      } else if (message.type === "output_overflow") {
        setError(
          "Command output exceeded its retention limit. Open the action terminal to inspect the retained output.",
        );
      }
    });
    binding.fitAddon.fit();
    return () => {
      disposed = true;
      rememberPosition();
      sequencer.dispose();
      unsubscribe();
      controller.releaseEmulator(terminalId);
      clipboard.dispose();
      scrollSubscription.dispose();
      binding.dispose();
      bindingRef.current = null;
    };
  }, [controller, presentation, terminalId]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!controller}
          onClick={() => {
            const buffer = bindingRef.current?.terminal.buffer.active;
            if (!buffer) return;
            const text = Array.from(
              { length: buffer.length },
              (_, index) => buffer.getLine(index)?.translateToString(true) ?? "",
            ).join("\n");
            presentation.terminalText.set(terminalId, text);
            setTextOutput(text);
          }}
        >
          {textOutput === null ? "Read output as text" : "Update text output"}
        </Button>
        {textOutput !== null ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              presentation.terminalText.delete(terminalId);
              setTextOutput(null);
            }}
          >
            Show terminal output
          </Button>
        ) : null}
      </div>
      <div
        ref={container}
        role="region"
        aria-label="Setup action output, read only"
        aria-hidden="true"
        className={cn(
          "h-48 overflow-auto rounded-md bg-[var(--terminal-panel)] p-2",
          textOutput !== null && "hidden",
        )}
      />
      {textOutput !== null ? (
        <Textarea
          ref={textRef}
          readOnly
          value={textOutput}
          aria-label="Command output text snapshot"
          aria-live="off"
          className="h-48 resize-none font-mono text-xs"
          onScroll={(event) => {
            presentation.terminalTextScroll.set(terminalId, event.currentTarget.scrollTop);
          }}
        />
      ) : null}
      {transportError || error ? (
        <p role="status" className="break-words text-xs text-destructive">
          {transportError ?? error}
        </p>
      ) : null}
    </div>
  );
}
