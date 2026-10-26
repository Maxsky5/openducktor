import type { TerminalTab } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import type { TerminalSessionsModel } from "@openducktor/frontend-core/terminals/use-terminals";
import type { ReactElement } from "react";
import { useCommandGate } from "@/host-session/active-session-context";
import { Button } from "@/ui/button";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { terminalScreenStatus } from "./terminal-list-model";
import { TerminalView } from "./terminal-view";

export type TerminalPaneProps = {
  model: TerminalSessionsModel;
  terminalId: string;
  /** Removes a lost terminal from the list. The host has no terminal to close. */
  onRemoveLost: (tab: TerminalTab) => void;
  onBack?: (() => void) | undefined;
};

/** The terminal of `terminalId`, or the reason it cannot show. A lost terminal never restarts. */
export function TerminalPane({
  model,
  terminalId,
  onRemoveLost,
  onBack,
}: TerminalPaneProps): ReactElement {
  const gate = useCommandGate();
  const status = terminalScreenStatus(model, terminalId);
  const back = onBack ? (
    <Button label="Back to Terminals" variant="outline" onPress={onBack} />
  ) : null;
  switch (status.kind) {
    case "loading":
      return <LoadingState label="Loading the terminal" />;
    case "unavailable":
      return (
        <EmptyState
          icon="square-terminal"
          title="Terminals Unavailable"
          message={status.message}
          action={back}
        />
      );
    case "discovery_failed":
      return (
        <ErrorState
          title="Terminal Discovery Failed"
          message={status.message}
          onRetry={gate.open ? model.onRetryDiscovery : undefined}
          retryLabel="Retry Discovery"
          action={back}
        />
      );
    case "missing":
      return (
        <EmptyState
          icon="unlink"
          title="Terminal Not Found"
          message="The host no longer has this terminal. It closed, or the host restarted."
          action={back}
        />
      );
    case "lost":
      return (
        <EmptyState
          icon="unlink"
          title="Terminal Lost"
          message={status.tab.error}
          action={
            <Button
              label="Remove from List"
              variant="outline"
              onPress={() => onRemoveLost(status.tab)}
            />
          }
        />
      );
    case "ready":
      return (
        <TerminalView
          key={status.tab.terminalId}
          tab={status.tab}
          scopeKey={model.scopeKey}
          controller={model.controller}
          platform={model.platform}
          platformError={model.platformError}
          onLifecycle={model.onLifecycle}
          onTitleChange={model.onTitleChange}
          onForgotten={model.onForgotten}
        />
      );
  }
}
