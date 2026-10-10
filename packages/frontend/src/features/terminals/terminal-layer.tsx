import type { AppPlatform, TerminalLifecycle } from "@openducktor/contracts";
import {
  lazy,
  memo,
  type ReactElement,
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { TerminalExitNotice } from "./terminal-viewport-policy";
import type { TerminalSessionsModel, TerminalTab } from "./use-terminals";

/** A terminal viewport that a panel keeps mounted. */
export type MountedTerminal = {
  key: string;
  scopeKey: string;
  tab: TerminalTab;
  /** The value of its panel tab, or null for a terminal of another scope that has no tab here. */
  value: string | null;
};

type TerminalLayerProps = {
  terminals: TerminalSessionsModel;
  mounts: readonly MountedTerminal[];
  /** The mount key of the selected terminal, or null when the panel shows another tab. */
  activeKey: string | null;
  isVisible: boolean;
  focusRequest: number;
};

const viewportClassName =
  "h-full min-h-0 data-[viewport-state=inactive]:pointer-events-none data-[viewport-state=inactive]:absolute data-[viewport-state=inactive]:top-0 data-[viewport-state=inactive]:left-[calc(100%+1px)] data-[viewport-state=inactive]:w-full";

/**
 * Keeps the terminal viewports of one panel mounted. Only the selected terminal shows. A terminal
 * that moves to another panel mounts again there and attaches to the host again.
 */
export function TerminalLayer({
  terminals,
  mounts,
  activeKey,
  isVisible,
  focusRequest,
}: TerminalLayerProps): ReactElement {
  const currentScopeKey = useRef(terminals.scopeKey);
  const retryCreateRef = useRef(terminals.onRetryCreate);
  useLayoutEffect(() => {
    currentScopeKey.current = terminals.scopeKey;
    retryCreateRef.current = terminals.onRetryCreate;
  }, [terminals.onRetryCreate, terminals.scopeKey]);
  const retryTerminalCreation = useCallback(
    (ownerScopeKey: string, tabId: string, actionId: string | null): void => {
      if (ownerScopeKey !== currentScopeKey.current) return;
      retryCreateRef.current(ownerScopeKey, tabId, actionId);
    },
    [],
  );
  const hasActiveTerminal = activeKey !== null && mounts.some((mount) => mount.key === activeKey);
  return (
    <div
      data-testid="terminal-layer"
      data-active={hasActiveTerminal ? "true" : "false"}
      className="absolute inset-0 overflow-hidden bg-(--terminal-panel) data-[active=false]:pointer-events-none data-[active=false]:invisible"
    >
      {mounts.map((mount) => {
        const active = isVisible && mount.key === activeKey;
        const viewport = (
          <TerminalViewport
            scopeKey={mount.scopeKey}
            tab={mount.tab}
            controller={terminals.controller}
            focusRequest={active ? focusRequest : 0}
            active={active}
            platform={terminals.platform}
            onRetryCreate={retryTerminalCreation}
            onLifecycle={terminals.onLifecycle}
            onForgotten={terminals.onForgotten}
            onTitleChange={terminals.onTitleChange}
          />
        );
        // One element type for every mount, so a scope switch never remounts a viewport.
        return (
          <TabsContent
            key={mount.key}
            forceMount
            value={mount.value ?? mount.key}
            data-terminal-viewport
            data-viewport-state={active ? "active" : "inactive"}
            aria-hidden={!active}
            inert={!active}
            className={viewportClassName}
          >
            {viewport}
          </TabsContent>
        );
      })}
    </div>
  );
}

const LazyTerminalViewport = lazy(async () => {
  const module = await import("./terminal-viewport");
  return { default: module.TerminalViewport };
});

const TerminalViewport = memo(function TerminalViewport({
  scopeKey,
  tab,
  controller,
  focusRequest,
  active,
  platform,
  onRetryCreate,
  onLifecycle,
  onForgotten,
  onTitleChange,
}: {
  scopeKey: string;
  tab: TerminalTab;
  controller: TerminalSessionsModel["controller"];
  focusRequest: number;
  active: boolean;
  platform: AppPlatform | undefined;
  onRetryCreate: TerminalSessionsModel["onRetryCreate"];
  onLifecycle: TerminalSessionsModel["onLifecycle"];
  onForgotten: TerminalSessionsModel["onForgotten"];
  onTitleChange: TerminalSessionsModel["onTitleChange"];
}): ReactElement {
  const [attention, setAttention] = useState<string | null>(null);
  const [exitNotice, setExitNotice] = useState<TerminalExitNotice | null>(null);
  const notice = attention === null ? exitNotice : { text: attention, isFailure: true };
  const handleLifecycle = useCallback(
    (lifecycle: TerminalLifecycle, exit: TerminalExitNotice | null) => {
      if (tab.terminalId) onLifecycle(scopeKey, tab.terminalId, lifecycle);
      if (exit !== null) setExitNotice(exit);
    },
    [onLifecycle, scopeKey, tab.terminalId],
  );
  const handleForgotten = useCallback(
    (message: string) => {
      if (tab.terminalId) onForgotten(scopeKey, tab.terminalId, message);
    },
    [onForgotten, scopeKey, tab.terminalId],
  );
  const handleTitleChange = useCallback(
    (title: string) => {
      if (tab.terminalId) onTitleChange(scopeKey, tab.terminalId, title);
    },
    [onTitleChange, scopeKey, tab.terminalId],
  );
  if (tab.error) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="max-w-[70ch] text-sm text-destructive">{tab.error}</p>
        {tab.requestState === "lost" || !active ? null : (
          <Button
            type="button"
            variant="outline"
            onClick={() => onRetryCreate(scopeKey, tab.tabId, tab.actionId)}
          >
            Retry terminal creation
          </Button>
        )}
      </div>
    );
  }
  if (!tab.terminalId) {
    return (
      <div
        data-testid="terminal-starting-surface"
        className="h-full min-h-0 bg-(--terminal-panel)"
      />
    );
  }
  if (!controller) {
    return (
      <div
        data-testid="terminal-unavailable-surface"
        className="h-full min-h-0 bg-(--terminal-panel)"
      />
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <Suspense
          fallback={
            <div
              data-testid="terminal-loading-surface"
              className="h-full min-h-0 bg-(--terminal-panel)"
            />
          }
        >
          <LazyTerminalViewport
            terminalId={tab.terminalId}
            controller={controller}
            platform={platform}
            active={active}
            focusRequest={focusRequest}
            onAttention={setAttention}
            onLifecycle={handleLifecycle}
            onForgotten={handleForgotten}
            onTitleChange={handleTitleChange}
          />
        </Suspense>
      </div>
      {notice ? (
        <p
          role="status"
          aria-label="Terminal status"
          className={cn(
            "shrink-0 border-t border-border px-3 py-1.5 text-xs",
            notice.isFailure
              ? "bg-warning-surface text-warning-surface-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {notice.text}
        </p>
      ) : null}
    </div>
  );
});

/** Discovery and transport failures. Panels that show terminals render this above their body. */
export function TerminalStatusMessages({
  terminals,
}: {
  terminals: Pick<
    TerminalSessionsModel,
    "discoveryError" | "transportError" | "isLoading" | "onRetryDiscovery"
  >;
}): ReactElement | null {
  if (terminals.discoveryError === null && terminals.transportError === null) return null;
  return (
    <div className="shrink-0">
      {terminals.discoveryError !== null ? (
        <div className="flex items-center gap-3 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          <p role="alert" className="min-w-0 flex-1 break-words">
            Terminal discovery failed: {terminals.discoveryError}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={terminals.onRetryDiscovery}
            disabled={terminals.isLoading}
          >
            Retry terminal discovery
          </Button>
        </div>
      ) : null}
      {terminals.transportError !== null ? (
        <p role="alert" className="bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          Terminal transport failed: {terminals.transportError}
        </p>
      ) : null}
    </div>
  );
}
