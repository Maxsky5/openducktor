import { useQuery } from "@tanstack/react-query";
import { lazy, memo, type ReactElement, Suspense, useCallback } from "react";
import type { TerminalFailure } from "@openducktor/contracts";
import { useTerminalTransport } from "@/features/terminals/use-terminal-transport";
import { getShellBridge } from "@/lib/shell-bridge";
import { platformQueryOptions } from "@/state/queries/system";

const ignoreMetadata = (): void => undefined;
const LazyTerminalViewport = lazy(async () => {
  const module = await import("@/features/terminals/terminal-viewport");
  return { default: module.TerminalViewport };
});

type AgentStudioDevServerTerminalProps = {
  terminalId: string;
  onRendererError: (message: string | null) => void;
};

export const AgentStudioDevServerTerminal = memo(function AgentStudioDevServerTerminal({
  terminalId,
  onRendererError,
}: AgentStudioDevServerTerminalProps): ReactElement {
  const { controller } = useTerminalTransport(getShellBridge().terminals, onRendererError);
  const platform = useQuery(platformQueryOptions());
  const handleForgotten = useCallback(
    (message: string, failure: TerminalFailure | null) => {
      if (failure) onRendererError(message);
    },
    [onRendererError],
  );
  return (
    <div className="h-full min-h-0 w-full" data-testid="agent-studio-dev-server-terminal">
      {controller ? (
        <Suspense
          fallback={<div className="h-full min-h-0 bg-[var(--dev-server-terminal-panel)]" />}
        >
          <LazyTerminalViewport
            mode="output"
            terminalId={terminalId}
            controller={controller}
            platform={platform.data}
            active
            focusRequest={0}
            onAttention={onRendererError}
            onForgotten={handleForgotten}
            onLifecycle={ignoreMetadata}
            onTitleChange={ignoreMetadata}
          />
        </Suspense>
      ) : null}
    </div>
  );
});
