import { useVirtualizer, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual";
import type { RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import {
  AGENT_CHAT_VIRTUAL_OVERSCAN_ITEMS,
  AGENT_CHAT_VIRTUAL_ROW_GAP_PX,
  AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT,
  type AgentChatVirtualRow,
  buildAgentChatVirtualRows,
  buildAgentChatVirtualRowsSignature,
} from "./agent-chat-thread-virtualization";

type UseAgentChatVirtualizationInput = {
  session: AgentSessionState | null;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
};

export type AgentChatVirtualizer = Virtualizer<HTMLDivElement, Element>;

type AgentChatVirtualRowsToRenderEntry = {
  row: AgentChatVirtualRow;
  virtualItem: VirtualItem;
};

type UseAgentChatVirtualizationResult = {
  activeSessionId: string | null;
  canRenderVirtualRows: boolean;
  hasRenderableSessionRows: boolean;
  shouldVirtualize: boolean;
  virtualRows: AgentChatVirtualRow[];
  virtualRowsToRender: AgentChatVirtualRowsToRenderEntry[];
  virtualizer: AgentChatVirtualizer;
};

type UseAgentChatVirtualRowsResult = {
  activeSessionId: string | null;
  shouldVirtualize: boolean;
  virtualRows: AgentChatVirtualRow[];
};

type UseVirtualRowMeasurementsInput = {
  activeSessionId: string | null;
  virtualRows: AgentChatVirtualRow[];
};

type UseVirtualRowMeasurementsResult = {
  estimateRowSize: (index: number) => number;
  measureVirtualRowElement: (element: Element) => number;
  resolveRowKey: (index: number) => string | number;
};

export function useAgentChatVirtualization({
  session,
  messagesContainerRef,
}: UseAgentChatVirtualizationInput): UseAgentChatVirtualizationResult {
  const { activeSessionId, shouldVirtualize, virtualRows } = useAgentChatVirtualRows(session);
  const { estimateRowSize, measureVirtualRowElement, resolveRowKey } = useVirtualRowMeasurements({
    activeSessionId,
    virtualRows,
  });
  const resolveScrollElement = useCallback((): HTMLDivElement | null => {
    return messagesContainerRef.current;
  }, [messagesContainerRef]);

  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? virtualRows.length : 0,
    getScrollElement: resolveScrollElement,
    estimateSize: estimateRowSize,
    measureElement: measureVirtualRowElement,
    getItemKey: resolveRowKey,
    overscan: AGENT_CHAT_VIRTUAL_OVERSCAN_ITEMS,
  });

  const virtualRowsToRender = useVirtualRowsToRender(virtualRows, virtualizer.getVirtualItems());
  const canRenderVirtualRows = shouldVirtualize && virtualRowsToRender.length > 0;
  const hasRenderableSessionRows = virtualRows.length > 0;

  return {
    activeSessionId,
    canRenderVirtualRows,
    hasRenderableSessionRows,
    shouldVirtualize,
    virtualRows,
    virtualRowsToRender,
    virtualizer,
  };
}

function useAgentChatVirtualRows(session: AgentSessionState | null): UseAgentChatVirtualRowsResult {
  const messageIdentityTokenByMessageRef = useRef<WeakMap<AgentChatMessage, number>>(new WeakMap());
  const nextMessageIdentityTokenRef = useRef(1);
  const virtualRowsCacheRef = useRef<{ signature: string | null; rows: AgentChatVirtualRow[] }>({
    signature: null,
    rows: [],
  });
  const resolveMessageIdentityToken = useCallback((message: AgentChatMessage): number => {
    const cached = messageIdentityTokenByMessageRef.current.get(message);
    if (typeof cached === "number") {
      return cached;
    }

    const nextToken = nextMessageIdentityTokenRef.current;
    nextMessageIdentityTokenRef.current += 1;
    messageIdentityTokenByMessageRef.current.set(message, nextToken);
    return nextToken;
  }, []);
  const virtualRowsSignature = session
    ? buildAgentChatVirtualRowsSignature(session, resolveMessageIdentityToken)
    : null;
  const virtualRows = useMemo(() => {
    const cached = virtualRowsCacheRef.current;
    if (cached.signature === virtualRowsSignature) {
      return cached.rows;
    }

    const nextRows = session ? buildAgentChatVirtualRows(session) : [];
    virtualRowsCacheRef.current = {
      signature: virtualRowsSignature,
      rows: nextRows,
    };
    return nextRows;
  }, [session, virtualRowsSignature]);
  const shouldVirtualize = virtualRows.length >= AGENT_CHAT_VIRTUALIZATION_MIN_ROW_COUNT;
  const activeSessionId = session?.sessionId ?? null;

  return {
    activeSessionId,
    shouldVirtualize,
    virtualRows,
  };
}

function useVirtualRowMeasurements({
  activeSessionId,
  virtualRows,
}: UseVirtualRowMeasurementsInput): UseVirtualRowMeasurementsResult {
  const virtualRowsRef = useRef(virtualRows);
  virtualRowsRef.current = virtualRows;
  const measuredSessionIdRef = useRef<string | null>(activeSessionId);
  const measuredRowHeightByKeyRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (measuredSessionIdRef.current === activeSessionId) {
      return;
    }
    measuredSessionIdRef.current = activeSessionId;
    measuredRowHeightByKeyRef.current = {};
  }, [activeSessionId]);

  const estimateRowSize = useCallback((index: number): number => {
    const rows = virtualRowsRef.current;
    const row = rows[index];
    if (!row) {
      return 0;
    }
    const trailingGap = index < rows.length - 1 ? AGENT_CHAT_VIRTUAL_ROW_GAP_PX : 0;
    const measuredHeight = measuredRowHeightByKeyRef.current[row.key];
    if (typeof measuredHeight === "number" && measuredHeight > 0) {
      return measuredHeight + trailingGap;
    }

    return 1 + trailingGap;
  }, []);

  const measureVirtualRowElement = useCallback((element: Element): number => {
    const measuredHeight = element.getBoundingClientRect().height;
    let rowKey = element.getAttribute("data-row-key");

    if (!rowKey) {
      const indexValue = Number.parseInt(element.getAttribute("data-index") ?? "", 10);
      const row =
        Number.isFinite(indexValue) && indexValue >= 0
          ? virtualRowsRef.current[indexValue]
          : undefined;
      rowKey = row?.key ?? null;
    }

    if (rowKey && measuredHeight > 0) {
      const previousHeight = measuredRowHeightByKeyRef.current[rowKey];
      if (typeof previousHeight !== "number") {
        measuredRowHeightByKeyRef.current[rowKey] = measuredHeight;
      } else if (Math.abs(previousHeight - measuredHeight) > 0.5) {
        measuredRowHeightByKeyRef.current[rowKey] = measuredHeight;
      }
    }
    return measuredHeight;
  }, []);

  const resolveRowKey = useCallback((index: number): string | number => {
    return virtualRowsRef.current[index]?.key ?? index;
  }, []);

  return { estimateRowSize, measureVirtualRowElement, resolveRowKey };
}

function useVirtualRowsToRender(
  virtualRows: AgentChatVirtualRow[],
  virtualItems: VirtualItem[],
): AgentChatVirtualRowsToRenderEntry[] {
  return useMemo(
    () =>
      virtualItems
        .map((virtualItem) => {
          const row = virtualRows[virtualItem.index];
          if (!row) {
            return null;
          }
          return { row, virtualItem };
        })
        .filter((entry): entry is AgentChatVirtualRowsToRenderEntry => entry !== null),
    [virtualItems, virtualRows],
  );
}
