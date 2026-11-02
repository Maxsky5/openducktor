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
import { TerminalNoticeStrip, TerminalViewportNotices } from "./terminal-notice";
import { tabLinkIds } from "@/components/ui/tab-link-ids";
import { TabsContent } from "@/components/ui/tabs";
import { canRetryTerminalCreation } from "@openducktor/frontend-core/terminals/terminal-presentation-state";
import type {
  TerminalSessionsModel,
  TerminalTab,
} from "@openducktor/frontend-core/terminals/use-terminals";

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
  /** A shown view can paint before its content becomes ready for input and focus. */
  isInteractive: boolean;
  focusRequest: number;
  /** The ID base of the panel tabs, so each viewport links to its tab. */
  tabIdBase: string;
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
  isInteractive,
  focusRequest,
  tabIdBase,
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
        const shown = isVisible && mount.key === activeKey;
        const canInteract = shown && isInteractive;
        const viewport = (
          <TerminalViewport
            scopeKey={mount.scopeKey}
            tab={mount.tab}
            controller={terminals.controller}
            focusRequest={canInteract ? focusRequest : 0}
            active={canInteract}
            platform={terminals.platform}
            onRetryCreate={retryTerminalCreation}
            onLifecycle={terminals.onLifecycle}
            onForgotten={terminals.onForgotten}
            onTitleChange={terminals.onTitleChange}
          />
        );
        const value = mount.value ?? mount.key;
        // One element type for every mount, so a scope switch never remounts a viewport.
        return (
          <TabsContent
            key={mount.key}
            forceMount
            value={value}
            {...tabLinkIds(tabIdBase, value).content}
            data-terminal-viewport
            data-viewport-state={shown ? "active" : "inactive"}
            aria-hidden={!shown}
            inert={!canInteract}
            className={viewportClassName}
          >
            {viewport}
          </TabsContent>
        );
      })}
    </div>
  );
}

/**
 * Discovery and transport failures. Panels that show terminals render this above their body. A
 * dismissed discovery failure still blocks new terminals, so the start controls then offer Retry.
 */
export function TerminalStatusMessages({
  terminals,
}: {
  terminals: Pick<
    TerminalSessionsModel,
    | "discoveryNotice"
    | "onDismissDiscoveryError"
    | "transportNotice"
    | "onDismissTransportError"
    | "isLoading"
    | "onRetryDiscovery"
  >;
}): ReactElement | null {
  if (terminals.discoveryNotice === null && terminals.transportNotice === null) return null;
  return (
    <div className="shrink-0">
      {terminals.discoveryNotice !== null ? (
        <TerminalNoticeStrip
          tone="error"
          role="alert"
          action={<TerminalDiscoveryRetryButton terminals={terminals} />}
          dismissLabel="Dismiss terminal discovery error"
          onDismiss={terminals.onDismissDiscoveryError}
        >
          Terminal discovery failed: {terminals.discoveryNotice}
        </TerminalNoticeStrip>
      ) : null}
      {terminals.transportNotice !== null ? (
        <TerminalNoticeStrip
          tone="error"
          role="alert"
          dismissLabel="Dismiss terminal transport error"
          onDismiss={terminals.onDismissTransportError}
        >
          Terminal transport failed: {terminals.transportNotice}
        </TerminalNoticeStrip>
      ) : null}
    </div>
  );
}

/** Reads the terminal list again after a discovery failure. */
function TerminalDiscoveryRetryButton({
  terminals,
}: {
  terminals: Pick<TerminalSessionsModel, "isLoading" | "onRetryDiscovery">;
}): ReactElement {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={terminals.onRetryDiscovery}
      disabled={terminals.isLoading}
    >
      Retry terminal discovery
    </Button>
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
  const [exitText, setExitText] = useState<string | null>(null);
  const handleLifecycle = useCallback(
    (lifecycle: TerminalLifecycle, exit: string | null) => {
      if (tab.terminalId) onLifecycle(scopeKey, tab.terminalId, lifecycle);
      if (exit !== null) setExitText(exit);
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
        {!canRetryTerminalCreation(tab) || !active ? null : (
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
      <TerminalViewportNotices
        attention={attention}
        onDismissAttention={() => setAttention(null)}
        exitText={exitText}
      />
    </div>
  );
});
