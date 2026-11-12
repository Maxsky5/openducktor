// The tab bar of the mobile app: Sessions and Tasks on the left, Host and Settings on the right, and
// the violet create button in a cradle in the middle. The Sessions tab shows the Needs you count on
// a red badge. Sources: app-tab-bar.tsx, tab-button.tsx, create-button.tsx, and
// tab-bar-geometry.ts in apps/mobile/src/navigation/tab-bar.
import {
  type LucideIcon,
  MessagesSquare,
  Plus,
  Server,
  Settings,
  SquareKanban,
} from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../flag";
import "./TabBar.css";

export type MobileTab = "sessions" | "tasks" | "host" | "settings";

/** The geometry of tab-bar-geometry.ts, in dp, at the width of the phone. */
const BAR = { width: 411, height: 64, create: 56, lift: -12, gap: 5, shoulder: 16 } as const;
const CRADLE = BAR.create / 2 + BAR.gap;
const CENTER_Y = -BAR.lift;
const REACH = Math.sqrt((CRADLE + BAR.shoulder) ** 2 - (BAR.shoulder - CENTER_Y) ** 2);

/** The top edge of the bar, with the cradle in its middle. */
function edgePath(): string {
  const center = BAR.width / 2;
  const reach = CRADLE / (CRADLE + BAR.shoulder);
  const meetX = REACH * reach;
  const meetY = CENTER_Y + (BAR.shoulder - CENTER_Y) * reach;
  const shoulder = `${BAR.shoulder} ${BAR.shoulder} 0 0 1`;
  return [
    "M 0 0",
    `L ${center - REACH} 0`,
    `A ${shoulder} ${center - meetX} ${meetY}`,
    `A ${CRADLE} ${CRADLE} 0 0 0 ${center + meetX} ${meetY}`,
    `A ${shoulder} ${center + REACH} 0`,
    `L ${BAR.width} 0`,
  ].join(" ");
}

/** The top edge of the bar at the width of the phone. */
export const TAB_BAR_EDGE = edgePath();

const TABS = [
  { id: "sessions", label: "Sessions", Icon: MessagesSquare },
  { id: "tasks", label: "Tasks", Icon: SquareKanban },
  { id: "host", label: "Host", Icon: Server },
  { id: "settings", label: "Settings", Icon: Settings },
] as const satisfies readonly { id: MobileTab; label: string; Icon: LucideIcon }[];

type TabBarProps = {
  selected: MobileTab;
  /** The Needs you count of every workspace. The badge hides at 0, and a scene changes it. */
  needsYou: number;
};

function Tab({
  tab,
  selected,
  needsYou,
}: {
  tab: (typeof TABS)[number];
  selected: boolean;
  needsYou: number;
}): ReactElement {
  const { Icon } = tab;
  return (
    <span className="mob-tab" data-selected={flag(selected)} data-tab={tab.id}>
      <i className="mob-tab-marker" />
      <span className="mob-tab-icon">
        <Icon />
        {tab.id === "sessions" && (
          <b className="mob-tab-badge" hidden={needsYou === 0} data-tab-badge="">
            {needsYou > 99 ? "99+" : needsYou}
          </b>
        )}
      </span>
      <span className="mob-tab-label">{tab.label}</span>
    </span>
  );
}

export function TabBar({ selected, needsYou }: TabBarProps): ReactElement {
  return (
    <nav className="mob-tabbar" data-tabbar="">
      <svg className="mob-tabbar-surface" viewBox={`0 -1 ${BAR.width} 65`} aria-hidden="true">
        <path className="mob-tabbar-fill" d={`${TAB_BAR_EDGE} L ${BAR.width} 64 L 0 64 Z`} />
        <path className="mob-tabbar-edge" d={TAB_BAR_EDGE} />
      </svg>
      <span className="mob-tabbar-row">
        {TABS.slice(0, 2).map((tab) => (
          <Tab key={tab.id} tab={tab} selected={tab.id === selected} needsYou={needsYou} />
        ))}
        <span className="mob-tabbar-slot" />
        {TABS.slice(2).map((tab) => (
          <Tab key={tab.id} tab={tab} selected={tab.id === selected} needsYou={needsYou} />
        ))}
      </span>
      <span className="mob-create" data-create="">
        <Plus />
      </span>
    </nav>
  );
}
