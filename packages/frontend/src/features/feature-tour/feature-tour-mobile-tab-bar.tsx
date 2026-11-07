import {
  type LucideIcon,
  MessagesSquare,
  Plus,
  Server,
  Settings,
  SquareKanban,
} from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import { NEEDS_YOU_COUNT, SCREEN_WIDTH } from "./feature-tour-mobile-geometry";

// The tab bar of the mobile app (`apps/mobile/src/navigation/tab-bar`) in the phone of the tour.

// The tab bar geometry of `tab-bar-geometry.ts`.
const TAB_BAR = {
  height: 64,
  createSize: 56,
  createLift: -12,
  cradleGap: 5,
  shoulderRadius: 16,
} as const;
const CREATE_RISE = TAB_BAR.createSize / 2 + TAB_BAR.createLift;
const CRADLE_RADIUS = TAB_BAR.createSize / 2 + TAB_BAR.cradleGap;
const CREATE_CENTER_Y = -TAB_BAR.createLift;
const SHOULDER_REACH = Math.sqrt(
  (CRADLE_RADIUS + TAB_BAR.shoulderRadius) ** 2 - (TAB_BAR.shoulderRadius - CREATE_CENTER_Y) ** 2,
);

/** The top edge of the bar, with the cradle in its middle. */
const tabBarEdgePath = (width: number): string => {
  const center = width / 2;
  const reach = CRADLE_RADIUS / (CRADLE_RADIUS + TAB_BAR.shoulderRadius);
  const meetX = SHOULDER_REACH * reach;
  const meetY = CREATE_CENTER_Y + (TAB_BAR.shoulderRadius - CREATE_CENTER_Y) * reach;
  const shoulder = `${TAB_BAR.shoulderRadius} ${TAB_BAR.shoulderRadius} 0 0 1`;
  return [
    "M 0 0",
    `L ${center - SHOULDER_REACH} 0`,
    `A ${shoulder} ${center - meetX} ${meetY}`,
    `A ${CRADLE_RADIUS} ${CRADLE_RADIUS} 0 0 0 ${center + meetX} ${meetY}`,
    `A ${shoulder} ${center + SHOULDER_REACH} 0`,
    `L ${width} 0`,
  ].join(" ");
};

/** The outline of the bar: the top edge with its cradle, then down to the bottom edge. */
const tabBarPath = (width: number, height: number): string =>
  `${tabBarEdgePath(width)} L ${width} ${height} L 0 ${height} Z`;

type PhoneTab = { label: string; icon: LucideIcon; badge: number };

const TABS_BEFORE_CREATE: readonly PhoneTab[] = [
  { label: "Sessions", icon: MessagesSquare, badge: NEEDS_YOU_COUNT },
  { label: "Tasks", icon: SquareKanban, badge: 0 },
];
const TABS_AFTER_CREATE: readonly PhoneTab[] = [
  { label: "Host", icon: Server, badge: 0 },
  { label: "Settings", icon: Settings, badge: 0 },
];

/** `TabButton`: the icon over the label, and the violet bar on the top edge of the open tab. */
function TabButton({ tab }: { tab: PhoneTab }): ReactElement {
  const focused = tab.label === "Sessions";
  const Icon = tab.icon;
  return (
    <span className="relative flex h-full flex-1 items-center justify-center">
      {focused ? (
        <span className="absolute inset-x-0 top-0 flex justify-center">
          <span className="h-[4px] w-[44px] rounded-b-[4px] bg-primary dark:bg-violet-400" />
        </span>
      ) : null}
      <span
        className={cn(
          "flex h-[46px] min-w-[60px] max-w-[92%] flex-col items-center justify-center gap-px px-[12px]",
          focused ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <span className="relative">
          <Icon aria-hidden="true" size={25} className="block" />
          {tab.badge > 0 ? (
            <span className="absolute -right-[10px] -top-[6px] flex min-h-[18px] min-w-[18px] items-center justify-center rounded-[9px] border-2 border-card bg-rose-500 px-[5px] text-[10px] font-semibold leading-[12px] tracking-[0.2px] text-primary-foreground dark:bg-rose-400">
              {tab.badge}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            "truncate text-[11px] leading-[14px] tracking-[0.1px]",
            focused ? "font-semibold" : "font-medium",
          )}
        >
          {tab.label}
        </span>
      </span>
    </span>
  );
}

/** `BottomTabBar`: the surface with its cradle, the four tabs, and the raised create button. */
export function TourPhoneTabBar(): ReactElement {
  return (
    <div className="absolute inset-x-0 bottom-0" style={{ height: CREATE_RISE + TAB_BAR.height }}>
      {/* The view box starts 1 dp above the bar, so the hairline of the top edge shows in full. */}
      <svg
        aria-hidden="true"
        className="absolute left-0"
        style={{ top: CREATE_RISE - 1 }}
        width={SCREEN_WIDTH}
        height={TAB_BAR.height + 1}
        viewBox={`0 -1 ${SCREEN_WIDTH} ${TAB_BAR.height + 1}`}
      >
        <path d={tabBarPath(SCREEN_WIDTH, TAB_BAR.height)} className="fill-card" />
        <path
          d={tabBarEdgePath(SCREEN_WIDTH)}
          fill="none"
          strokeWidth={1}
          className="stroke-border"
        />
      </svg>
      <div
        className="absolute inset-x-0 flex items-center"
        style={{ top: CREATE_RISE, height: TAB_BAR.height }}
      >
        {TABS_BEFORE_CREATE.map((tab) => (
          <TabButton key={tab.label} tab={tab} />
        ))}
        <span className="shrink-0" style={{ width: 2 * SHOULDER_REACH }} />
        {TABS_AFTER_CREATE.map((tab) => (
          <TabButton key={tab.label} tab={tab} />
        ))}
      </div>
      <span
        className="absolute left-1/2 top-0 flex -translate-x-1/2 items-center justify-center rounded-full bg-linear-150 from-violet-500 to-primary to-70% text-primary-foreground shadow-[0_1px_2px_rgba(81,0,255,0.2),0_4px_12px_-4px_rgba(81,0,255,0.45)] dark:shadow-[0_4px_14px_-4px_rgba(81,0,255,0.6)]"
        style={{ width: TAB_BAR.createSize, height: TAB_BAR.createSize }}
      >
        <Plus aria-hidden="true" size={26} />
      </span>
    </div>
  );
}
