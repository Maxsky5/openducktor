import "@xterm/xterm/css/xterm.css";
import { memo, type ReactElement, useRef } from "react";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import {
  type CreateTerminalBinding,
  defaultCreateTerminalBinding,
  useDevServerTerminalBinding,
  useDevServerTerminalRendering,
} from "./use-agent-studio-dev-server-terminal";

type AgentStudioDevServerTerminalProps = {
  scriptId: string;
  terminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  onRendererError: (message: string | null) => void;
  createTerminalBinding?: CreateTerminalBinding;
};

export const AgentStudioDevServerTerminal = memo(function AgentStudioDevServerTerminal({
  scriptId,
  terminalBuffer,
  onRendererError,
  createTerminalBinding = defaultCreateTerminalBinding,
}: AgentStudioDevServerTerminalProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRenderController = useDevServerTerminalBinding({
    containerRef,
    createTerminalBinding,
    onRendererError,
  });

  useDevServerTerminalRendering({
    ...terminalRenderController,
    scriptId,
    terminalBuffer,
    onRendererError,
  });

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 w-full"
      data-testid="agent-studio-dev-server-terminal"
    />
  );
});
