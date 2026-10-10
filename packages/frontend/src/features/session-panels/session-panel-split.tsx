import {
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useLayoutEffect,
  useRef,
} from "react";
import type { GroupImperativeHandle, LayoutChangedMeta } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { cn } from "@/lib/utils";
import { SessionPanel } from "./session-panel";
import { useNarrowWindow } from "./use-narrow-window";
import type { SessionPanelModel } from "./use-session-panels";

export type SessionPanelSplitIds = {
  group: string;
  main: string;
  panel: string;
  separator?: string;
};

/** Sizes in percent of the group, and minimum and maximum sizes as CSS percentages. */
export type SessionPanelSplitSizes = {
  main: number;
  mainMin: string;
  panel: number;
  panelMin: string;
  panelMax?: string;
};

type SplitDirection = "horizontal" | "vertical";

type SplitPanelModel = Pick<SessionPanelModel, "presence" | "onSettled" | "onCollapsed">;

type SessionPanelSplitProps = {
  ids: SessionPanelSplitIds;
  model: SplitPanelModel;
  direction: SplitDirection;
  sizes: SessionPanelSplitSizes;
  /** The panel fills the group and hides the main content, as the bottom panel on a narrow window. */
  fillsGroup?: boolean;
  /** Keeps the panel content mounted while the panel is hidden, so terminals keep their screens. */
  keepPanelMounted?: boolean;
  separatorLabel?: string;
  className: string;
  mainClassName: string;
  panelClassName?: string;
  main: ReactNode;
  panel: ReactNode;
};

const axisSize = (element: HTMLElement, direction: SplitDirection): number =>
  direction === "horizontal" ? element.offsetWidth : element.offsetHeight;

const hasTransition = (element: HTMLElement): boolean =>
  getComputedStyle(element)
    .transitionDuration.split(",")
    .some((duration) => Number.parseFloat(duration) > 0);

/**
 * Sets the panel size for its presence. While the panel opens or closes, the panel and the main
 * area change size together, and the panel content keeps its open size at the outer edge. The
 * split tells the controller when the move ends.
 */
function usePanelMotion({
  ids,
  model,
  direction,
  openSize,
  groupRef,
  mainRef,
  panelRef,
  contentRef,
}: {
  ids: SessionPanelSplitIds;
  model: SplitPanelModel;
  direction: SplitDirection;
  openSize: () => number;
  groupRef: RefObject<GroupImperativeHandle | null>;
  mainRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
}): void {
  const { presence, onSettled } = model;
  const isOpen = presence === "opening" || presence === "open";
  const isMoving = presence === "opening" || presence === "closing";
  useLayoutEffect(() => {
    const size = isOpen ? openSize() : 0;
    const main = mainRef.current;
    const panel = panelRef.current;
    const content = contentRef.current;
    // A panel that a drag made zero wide is hidden already, so no transition runs for its hide.
    const isResize = size > 0 || (panel !== null && axisSize(panel, direction) > 0);
    if (isMoving && main && panel && content) {
      const panelSpace = axisSize(main, direction) + axisSize(panel, direction);
      content.style.setProperty("--session-panel-size", `${(panelSpace * openSize()) / 100}px`);
    }
    groupRef.current?.setLayout({ [ids.main]: 100 - size, [ids.panel]: size });
    if (!isMoving) return;
    // Without a size transition, as with reduced motion, the move ends at once.
    if (!isResize || !panel || !hasTransition(panel)) {
      onSettled();
      return;
    }
    const onTransitionEnd = (event: TransitionEvent): void => {
      // A reopen replaces the running transition. Wait for the one that runs now.
      if (event.target !== panel || panel.getAnimations().length > 0) return;
      onSettled();
    };
    panel.addEventListener("transitionend", onTransitionEnd);
    panel.addEventListener("transitioncancel", onTransitionEnd);
    return () => {
      panel.removeEventListener("transitionend", onTransitionEnd);
      panel.removeEventListener("transitioncancel", onTransitionEnd);
    };
  }, [
    contentRef,
    direction,
    groupRef,
    ids,
    isMoving,
    isOpen,
    mainRef,
    onSettled,
    openSize,
    panelRef,
  ]);
}

/**
 * Splits the main area of a session page and one session panel. The panel slides in and out, and
 * the main area resizes with it.
 */
export function SessionPanelSplit({
  ids,
  model,
  direction,
  sizes,
  fillsGroup = false,
  keepPanelMounted = false,
  separatorLabel,
  className,
  mainClassName,
  panelClassName,
  main,
  panel,
}: SessionPanelSplitProps): ReactElement {
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // The last size that the user gave the open panel.
  const panelSizeRef = useRef(sizes.panel);
  const openSize = useCallback(
    (): number => (fillsGroup ? 100 : panelSizeRef.current),
    [fillsGroup],
  );
  usePanelMotion({
    ids,
    model,
    direction,
    openSize,
    groupRef,
    mainRef,
    panelRef,
    contentRef,
  });
  const { onCollapsed } = model;
  const onLayoutChanged = useCallback(
    (layout: Record<string, number>, meta: LayoutChangedMeta): void => {
      const size = layout[ids.panel];
      if (size === undefined) return;
      if (size > 0) {
        if (!fillsGroup) panelSizeRef.current = size;
        return;
      }
      // A drag or a key on the separator collapsed the panel, so it counts as hidden. Its toggle
      // then shows it as closed, and one click opens it again.
      if (meta.isUserInteraction) onCollapsed();
    },
    [fillsGroup, ids.panel, onCollapsed],
  );
  const { presence } = model;
  const isPresent = presence !== "closed";
  const isOpen = presence === "opening" || presence === "open";
  const motion = presence === "opening" || presence === "closing" ? presence : undefined;
  const content = (
    <div
      className="relative h-full min-h-0 overflow-hidden [contain:layout_paint]"
      hidden={!isPresent}
    >
      <div
        ref={contentRef}
        data-slot="session-panel-content"
        data-side={direction === "horizontal" ? "right" : "bottom"}
        data-moving={motion}
        inert={!isOpen}
        className={cn("h-full min-h-0", panelClassName)}
      >
        {panel}
      </div>
    </div>
  );
  return (
    <ResizablePanelGroup
      id={ids.group}
      groupRef={groupRef}
      direction={direction}
      defaultLayout={{
        [ids.main]: isPresent ? sizes.main : 100,
        [ids.panel]: isPresent ? sizes.panel : 0,
      }}
      onLayoutChanged={onLayoutChanged}
      data-panel-motion={motion}
      className={className}
    >
      <ResizablePanel
        id={ids.main}
        elementRef={mainRef}
        defaultSize={`${sizes.main}%`}
        minSize={fillsGroup ? "0%" : sizes.mainMin}
      >
        <div className={mainClassName} hidden={fillsGroup && presence === "open"}>
          {main}
        </div>
      </ResizablePanel>
      {isPresent && !fillsGroup ? (
        <ResizableHandle id={ids.separator} aria-label={separatorLabel} withHandle />
      ) : null}
      <ResizablePanel
        id={ids.panel}
        elementRef={panelRef}
        collapsible
        collapsedSize="0%"
        defaultSize={`${sizes.panel}%`}
        minSize={fillsGroup ? "0%" : sizes.panelMin}
        maxSize={fillsGroup ? "100%" : sizes.panelMax}
      >
        {isPresent || keepPanelMounted ? content : null}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

const BOTTOM_PANEL_SIZES: SessionPanelSplitSizes = {
  main: 72,
  mainMin: "30%",
  panel: 28,
  panelMin: "16%",
  panelMax: "70%",
};

/**
 * Splits the session content and the bottom panel. On a narrow window the bottom panel fills the
 * page. The bottom panel stays mounted while hidden, so its terminals keep their screens.
 */
export function BottomPanelSplit({
  ids,
  model,
  className,
  mainClassName,
  children,
}: {
  ids: SessionPanelSplitIds;
  model: SessionPanelModel;
  className: string;
  mainClassName: string;
  children: ReactNode;
}): ReactElement {
  const isNarrow = useNarrowWindow();
  return (
    <SessionPanelSplit
      ids={ids}
      model={model}
      direction="vertical"
      sizes={BOTTOM_PANEL_SIZES}
      fillsGroup={isNarrow}
      keepPanelMounted
      separatorLabel="Resize bottom panel"
      className={className}
      mainClassName={mainClassName}
      main={children}
      panel={<SessionPanel model={model} />}
    />
  );
}
