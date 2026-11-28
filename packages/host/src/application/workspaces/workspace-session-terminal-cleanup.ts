import type { WorkspaceSessionRefInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { TerminalService } from "../terminals/terminal-service";
import { reportPartialTerminalCleanup } from "../terminals/terminal-cleanup-progress";

export const acquireWorkspaceSessionTerminalCleanup = (
  terminalService: Pick<TerminalService, "acquireWorkspaceSessionCleanup">,
  input: WorkspaceSessionRefInput,
) =>
  terminalService.acquireWorkspaceSessionCleanup(input).pipe(
    Effect.tapError(reportPartialTerminalCleanup),
    Effect.mapError(
      (cause) =>
        new HostOperationError({
          operation: "workspaceSession.archive.terminals",
          message: `Could not stop this session's terminals: ${cause.message}`,
          cause,
        }),
    ),
  );
