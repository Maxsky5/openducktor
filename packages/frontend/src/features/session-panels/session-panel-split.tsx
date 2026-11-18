import {
  type CSSProperties,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
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

/**
 * Hides the separator of a closed panel, and keeps it between the panels at zero size. When the
 * group registers, the library maps each separator to the panels next to it by their offsets. A
 * separator with `display: none` has no offset, so it maps to no panels and its arrow keys throw.
 */
const HIDDEN_SEPARATOR_STYLE: CSSProperties = { visibility: "hidden", width: 0, height: 0 };

const axisSize = (element: HTMLElement, direction: SplitDirection): number =>
  direction === "horizontal" ? element.offsetWidth : element.offsetHeight;

const hasTransition = (element: HTMLElement): boolean =>
  getComputedStyle(element)
    .transitionDuration.split(",")
    .some((duration) => Number.parseFloat(duration) > 0);

/**
 * Sets the panel size for its presence. While the panel opens or closes, the panel and the main
 * area change size together with a transition, which reverses from the current sizes. The panel
 * content keeps its open size at the inner edge, so it moves with that edge. The split tells the
 * controller when the move ends.
 */
function usePanelMotion({
  mainId,
  panelId,
  model,
  direction,
  openSize,
  groupRef,
  mainRef,
  panelRef,
}: {
  mainId: string;
  panelId: string;
  model: SplitPanelModel;
  direction: SplitDirection;
  openSize: () => number;
  groupRef: RefObject<GroupImperativeHandle | null>;
  mainRef: RefObject<HTMLDivElement | null>;
  panelRef: RefObject<HTMLDivElement | null>;
}): void {
  const { presence, onSettled } = model;
  const isOpen = presence === "opening" || presence === "open";
  const isMoving = presence === "opening" || presence === "closing";
  useLayoutEffect(() => {
    const size = isOpen ? openSize() : 0;
    const main = mainRef.current;
    const panel = panelRef.current;
    // A panel resizes when it opens to a size, or when it shows before it closes. A panel that a
    // drag made zero wide is hidden already, so no transition runs for its hide.
    const isResize = size > 0 || (panel !== null && axisSize(panel, direction) > 0);
    if (isMoving && main && panel) {
      const panelSpace = axisSize(main, direction) + axisSize(panel, direction);
      // The content inherits the size from the panel, which stays mounted. Content that mounts
      // again on the next open lays out at its open size from its first layout.
      panel.style.setProperty("--session-panel-size", `${(panelSpace * openSize()) / 100}px`);
    }
    groupRef.current?.setLayout({ [mainId]: 100 - size, [panelId]: size });
    if (!isMoving) return;
    // Without a size transition, as with reduced motion, the move ends at once.
    if (!isResize || !panel || !hasTransition(panel)) {
      onSettled();
      return;
    }
    const onResizeEnd = (event: TransitionEvent): void => {
      // A reverse replaces the running transition with one that starts at the current size. Wait
      // for the transition that runs now.
      if (event.target !== panel || panel.getAnimations().length > 0) return;
      onSettled();
    };
    panel.addEventListener("transitionend", onResizeEnd);
    panel.addEventListener("transitioncancel", onResizeEnd);
    return () => {
      panel.removeEventListener("transitionend", onResizeEnd);
      panel.removeEventListener("transitioncancel", onResizeEnd);
    };
  }, [
    direction,
    groupRef,
    isMoving,
    isOpen,
    mainRef,
    mainId,
    onSettled,
    openSize,
    panelRef,
    panelId,
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
  // Kept session views mount the same split more than once. The library looks up groups by ID.
  const suffix = useId();
  const groupId = `${ids.group}-${suffix}`;
  const mainId = `${ids.main}-${suffix}`;
  const panelId = `${ids.panel}-${suffix}`;
  const groupRef = useRef<GroupImperativeHandle | null>(null);
  const mainRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The last size that the user gave the open panel.
  const panelSizeRef = useRef(sizes.panel);
  const openSize = useCallback(
    (): number => (fillsGroup ? 100 : panelSizeRef.current),
    [fillsGroup],
  );
  usePanelMotion({
    mainId,
    panelId,
    model,
    direction,
    openSize,
    groupRef,
    mainRef,
    panelRef,
  });
  const { onCollapsed } = model;
  const onLayoutChanged = useCallback(
    (layout: Record<string, number>, meta: LayoutChangedMeta): void => {
      const size = layout[panelId];
      if (size === undefined) return;
      if (size > 0) {
        if (!fillsGroup) panelSizeRef.current = size;
        return;
      }
      // A drag or a key on the separator collapsed the panel, so it counts as hidden. Its toggle
      // then shows it as closed, and one click opens it again.
      if (meta.isUserInteraction) onCollapsed();
    },
    [fillsGroup, panelId, onCollapsed],
  );
  const { presence } = model;
  const isPresent = presence !== "closed";
  const motion = presence === "opening" || presence === "closing" ? presence : undefined;
  // The separator moves with the panel edge, and only an open panel resizes with it.
  const showsSeparator = isPresent && !fillsGroup;
  return (
    <ResizablePanelGroup
      id={groupId}
      groupRef={groupRef}
      direction={direction}
      defaultLayout={{
        [mainId]: isPresent ? sizes.main : 100,
        [panelId]: isPresent ? sizes.panel : 0,
      }}
      onLayoutChanged={onLayoutChanged}
      data-panel-motion={motion}
      className={className}
      style={GROUP_STYLE}
    >
      <ResizablePanel
        id={mainId}
        elementRef={mainRef}
        defaultSize={`${sizes.main}%`}
        minSize={fillsGroup ? "0%" : sizes.mainMin}
      >
        <div className={mainClassName} hidden={fillsGroup && presence === "open"}>
          {main}
        </div>
      </ResizablePanel>
      {/* The separator stays mounted, so a close or an open does not register the group again.
          A group that registers in a hidden kept view ignores sizes until the view shows. */}
      <ResizableHandle
        aria-label={separatorLabel}
        withHandle
        disabled={presence !== "open" || fillsGroup}
        style={showsSeparator ? undefined : HIDDEN_SEPARATOR_STYLE}
      />
      <ResizablePanel
        id={panelId}
        elementRef={panelRef}
        collapsible
        collapsedSize="0%"
        defaultSize={`${sizes.panel}%`}
        minSize={fillsGroup ? "0%" : sizes.panelMin}
        maxSize={fillsGroup ? "100%" : sizes.panelMax}
      >
        {isPresent || keepPanelMounted ? (
          <SessionPanelContent presence={presence} direction={direction} className={panelClassName}>
            {panel}
          </SessionPanelContent>
        ) : null}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

/**
 * The grip of the separator sticks out of the group while the panel is almost closed. A hidden
 * overflow can scroll, so a tab that scrolls into view would move the page. The group clips instead.
 */
const GROUP_STYLE: CSSProperties = { overflow: "clip" };

/**
 * The content of a session panel. While the panel moves, the content keeps its open size at the
 * inner edge, so it moves with that edge, and the panel clips the part that is not in view.
 */
function SessionPanelContent({
  presence,
  direction,
  className,
  children,
}: {
  presence: SplitPanelModel["presence"];
  direction: SplitDirection;
  className: string | undefined;
  children: ReactNode;
}): ReactElement {
  const isMoving = presence === "opening" || presence === "closing";
  return (
    // The box clips and does not scroll. A hidden overflow can scroll, and a focus or a tab that
    // scrolls into view would then move the content that sticks out while the panel moves.
    <div
      className="relative h-full min-h-0 overflow-clip [contain:layout_paint]"
      hidden={presence === "closed"}
    >
      <div
        data-slot="session-panel-content"
        data-side={direction === "horizontal" ? "right" : "bottom"}
        data-moving={isMoving ? presence : undefined}
        inert={presence !== "opening" && presence !== "open"}
        className={cn("h-full min-h-0", className)}
      >
        {children}
      </div>
    </div>
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
