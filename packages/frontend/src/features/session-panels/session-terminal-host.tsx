import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { Tabs } from "@/components/ui/tabs";
import { TerminalLayer } from "@/features/terminals";
import type { SessionPanelModel } from "./use-session-panels";
import { SessionViewContext } from "../session-navigation/session-view-context";

type Binding = {
  model: SessionPanelModel;
  anchor: HTMLDivElement | null;
  isActive: boolean;
  /** Focus requests from before the view last became active. A return to a view does not focus. */
  focusBase: number;
};
type Surface = {
  key: string;
  viewId: string;
  container: HTMLDivElement;
  bindings: Map<string, Binding>;
};
type Host = ReturnType<typeof createHost>;
const TerminalHostContext = createContext<Host | null>(null);

/** Views of one task share terminal roots. Moving a root keeps xterm and its transport. */
export function SessionTerminalHost({
  viewIds,
  children,
}: {
  viewIds: readonly string[];
  children: ReactNode;
}) {
  const parking = useRef<HTMLDivElement>(null);
  const [host] = useState(() => createHost(parking));
  const surfaces = useSyncExternalStore(host.subscribe, host.read, host.read);
  useLayoutEffect(() => host.prune(new Set(viewIds)), [host, viewIds]);
  return (
    <TerminalHostContext value={host}>
      {children}
      <div hidden ref={parking} />
      {surfaces.map(({ key, container, model, isVisible, focusRequest }) =>
        createPortal(
          <Tabs value={model.selectedTabId ?? ""} className="contents">
            <TerminalLayer
              terminals={model.terminals}
              mounts={model.terminalMounts}
              activeKey={model.activeTerminalKey}
              isVisible={isVisible}
              focusRequest={focusRequest}
            />
          </Tabs>,
          container,
          key,
        ),
      )}
    </TerminalHostContext>
  );
}

export function SessionTerminalSurface({ model }: { model: SessionPanelModel }) {
  const host = useContext(TerminalHostContext);
  const view = useContext(SessionViewContext);
  const viewId = view?.id ?? null;
  const anchor = useRef<HTMLDivElement | null>(null);
  const scope = model.terminals.scopeKey;
  const key = scope === null ? null : `${scope}:${model.panel}`;
  const bind = useCallback(
    (node: HTMLDivElement | null) => {
      anchor.current = node;
      if (host && key && viewId) host.place(key, viewId, node);
    },
    [host, key, viewId],
  );
  useLayoutEffect(() => {
    if (host && view) host.update(key, view.id, view.isActive, model, anchor.current);
  }, [host, key, model, view]);
  if (!host || !view)
    return (
      <TerminalLayer
        terminals={model.terminals}
        mounts={model.terminalMounts}
        activeKey={model.activeTerminalKey}
        isVisible={model.isVisible}
        focusRequest={model.focusRequest}
      />
    );
  // The anchor and its moved root add no box, so only the terminal layer can cover panel content.
  return <div ref={bind} className="contents" data-terminal-anchor />;
}

function createHost(parking: RefObject<HTMLDivElement | null>) {
  const entries = new Map<string, Surface>();
  const listeners = new Set<() => void>();
  let snapshot: Array<{
    key: string;
    container: HTMLDivElement;
    model: SessionPanelModel;
    isVisible: boolean;
    focusRequest: number;
  }> = [];
  const move = (entry: Surface) => {
    const binding = entry.bindings.get(entry.viewId);
    const target = binding?.anchor ?? parking.current;
    if (target && entry.container.parentNode !== target) target.appendChild(entry.container);
  };
  const notify = () => {
    snapshot = [...entries.values()].map((entry) => {
      const binding = entry.bindings.get(entry.viewId)!;
      const { model } = binding;
      const isShown = binding.anchor !== null && binding.isActive;
      return {
        key: entry.key,
        container: entry.container,
        isVisible: isShown && model.isVisible,
        focusRequest: isShown ? model.focusRequest - binding.focusBase : 0,
        model: {
          ...model,
          terminalMounts: model.terminalMounts.filter(
            (mount) => mount.scopeKey === model.terminals.scopeKey,
          ),
        },
      };
    });
    for (const listener of listeners) listener();
  };
  const dropUnused = () => {
    for (const [key, entry] of entries) {
      if (entry.bindings.size === 0) {
        entries.delete(key);
        entry.container.remove();
      } else {
        if (!entry.bindings.has(entry.viewId)) entry.viewId = [...entry.bindings.keys()].at(-1)!;
        move(entry);
      }
    }
  };
  const host = {
    read: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    place(key: string, viewId: string, anchor: HTMLDivElement | null) {
      const entry = entries.get(key);
      const binding = entry?.bindings.get(viewId);
      if (!entry || !binding || binding.anchor === anchor) return;
      binding.anchor = anchor;
      if (entry.viewId === viewId) {
        move(entry);
        notify();
      }
    },
    update(
      key: string | null,
      viewId: string,
      isActive: boolean,
      model: SessionPanelModel,
      anchor: HTMLDivElement | null,
    ) {
      for (const entry of entries.values()) {
        if (entry.key !== key && entry.bindings.get(viewId)?.model.panel === model.panel)
          entry.bindings.delete(viewId);
      }
      if (key !== null) {
        let entry = entries.get(key);
        if (!entry) {
          const container = document.createElement("div");
          container.className = "contents";
          entry = { key, viewId, container, bindings: new Map() };
          entries.set(key, entry);
        }
        const previous = entry.bindings.get(viewId);
        const focusBase =
          isActive && previous?.isActive === false
            ? model.focusRequest
            : (previous?.focusBase ?? 0);
        entry.bindings.set(viewId, { model, anchor, isActive, focusBase });
        if (isActive) entry.viewId = viewId;
      }
      dropUnused();
      notify();
    },
    prune(viewIds: ReadonlySet<string>) {
      let changed = false;
      for (const entry of entries.values())
        for (const id of entry.bindings.keys()) {
          if (!viewIds.has(id)) {
            entry.bindings.delete(id);
            changed = true;
          }
        }
      if (changed) {
        dropUnused();
        notify();
      }
    },
  };
  return host;
}
