import {
  ATTENTION_REASON_LABELS,
  SESSION_GROUP_LABELS,
  sessionEntryShortTime,
  visibleAttentionReasons,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-entry-labels";
import {
  sessionEntryDotTone,
  sessionEntryTitleTone,
} from "@openducktor/frontend-core/sessions/navigation/session-entry-presentation";
import type { SessionNavigationEntry } from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import { Archive, ChevronDown, ListTree, type LucideIcon, Search } from "lucide-react";
import type { ReactElement } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import {
  SESSION_DOT_CLASSES,
  SESSION_GROUP_COUNT_CLASSES,
  SESSION_GROUP_ICON_CLASSES,
  SESSION_TITLE_CLASSES,
  sessionEntryIconClassName,
} from "@/components/layout/sidebar/session-navigation-styles";
import {
  SESSION_GROUP_ICONS,
  sessionEntryIcon,
} from "@/components/layout/sidebar/session-navigation-entry-model";
import { statusBadgeClassName } from "@/lib/task-status-presentation";
import { cn } from "@/lib/utils";
import {
  BEZEL,
  DENSITY,
  FRAME,
  GROUP_HEADER_HEIGHT,
  HEADER_HEIGHT,
  PHONE_GROUPS,
  type PhoneGroup,
  RIM,
  SCOPE_SWITCH_HEIGHT,
  SCREEN_HEIGHT,
  SCREEN_RADIUS,
  SCREEN_WIDTH,
  SESSION_ROW_INSET,
  STATUS_BAR_HEIGHT,
  sessionRowHeight,
  TOUR_PHONE_SIZE,
} from "./feature-tour-mobile-geometry";
import { TourPhoneTabBar } from "./feature-tour-mobile-tab-bar";
import { SAMPLE_NOW, WORKSPACES } from "./feature-tour-samples";

// The Sessions tab of the mobile app (`apps/mobile`) on an Android phone, as web markup. One CSS
// pixel is one dp. Each size, space, radius, and color comes from the styles of the mobile screen:
// `sessions-screen.tsx`, `session-row.tsx`, `session-group-header.tsx`, `stack-header.tsx`, and
// the tab bar in `navigation/tab-bar`. The colors are the desktop theme tokens that the mobile
// theme copies, so the screen follows the light and dark themes.

/** The mobile `shadows.card`: a light lift in the light theme, and none in the dark theme. */
const CARD_SHADOW = "shadow-[0_1px_2px_rgba(15,23,42,0.05)] dark:shadow-none";

/** The row surfaces of `session-row.tsx`: warning, running, or plain. */
const rowSurfaceClassName = (entry: SessionNavigationEntry): string => {
  if (entry.attention.length > 0) return "border-warning-border bg-warning-surface";
  if (entry.status.kind === "running") return "border-info-border bg-info-surface";
  return "border-sidebar-border bg-sidebar";
};

/** The Android status bar: the clock, the punch-hole camera, and the system icons. */
function StatusBar(): ReactElement {
  return (
    <div className="relative text-black dark:text-white" style={{ height: STATUS_BAR_HEIGHT }}>
      <span
        className="absolute left-[16px] top-0 text-[14.5px] leading-[24px]"
        style={{ fontFamily: "Roboto, system-ui, sans-serif" }}
      >
        12:00
      </span>
      <span className="absolute left-1/2 top-[6px] size-[12px] -translate-x-1/2 rounded-full bg-black ring-1 ring-neutral-800" />
      {/* The system icons, drawn in the pixels of the reference screenshot. */}
      <svg
        aria-hidden="true"
        className="absolute"
        style={{ left: 805 / DENSITY, top: 13 / DENSITY }}
        width={202 / DENSITY}
        height={36 / DENSITY}
        viewBox="805 13 202 36"
      >
        <g fill="currentColor">
          <rect x={805.5} y={34} width={6} height={12.5} rx={3} />
          <rect x={818} y={27} width={6} height={19.5} rx={3} />
          <rect x={830.5} y={20} width={6} height={26.5} rx={3} />
          <rect x={843} y={15} width={6} height={31.5} rx={3} opacity={0.45} />
          <circle cx={887.5} cy={42.5} r={4} />
        </g>
        <g fill="none" stroke="currentColor" strokeWidth={6.5} strokeLinecap="round">
          <path d="M 870 24 A 33 33 0 0 1 905 24" />
          <path d="M 878 32.5 A 23 23 0 0 1 897 32.5" />
        </g>
        <rect x={925} y={14} width={62.5} height={33.5} rx={7.5} fill="#18cc47" />
        <path
          d="M996.8 18.5 L984 33 L993.5 33.5 L992 42 L1004.8 28 L995.5 28 Z"
          fill="currentColor"
          strokeWidth={3.5}
          strokeLinejoin="round"
          paintOrder="stroke"
          className="stroke-sidebar"
        />
      </svg>
    </div>
  );
}

/** A plain `IconButton`: a 44 dp touch area around the icon. */
function HeaderIcon({ icon: Icon, size }: { icon: LucideIcon; size: number }): ReactElement {
  return (
    <span className="flex size-[44px] items-center justify-center text-foreground">
      <Icon aria-hidden="true" size={size} />
    </span>
  );
}

/** `StackHeader` with the actions of `SessionsHeaderActions` and the search control. */
function Header(): ReactElement {
  return (
    <div className="flex items-center gap-[4px] pe-[16px]" style={{ height: HEADER_HEIGHT }}>
      {/* Android adds font padding above the title, which moves it 1 dp down. */}
      <p className="min-w-0 flex-1 truncate ps-[16px] pt-[2px] text-[17px] font-semibold leading-[22px] text-foreground">
        Sessions
      </p>
      <span className="flex items-center gap-[4px]">
        <HeaderIcon icon={ListTree} size={22} />
        <HeaderIcon icon={Archive} size={22} />
      </span>
      <HeaderIcon icon={Search} size={24} />
    </div>
  );
}

/** The `SegmentedControl` of the list scope, with All workspaces selected. */
function ScopeSwitch(): ReactElement {
  const options = [
    { label: WORKSPACES.fieldnotes.workspaceName, selected: false },
    { label: "All workspaces", selected: true },
  ];
  return (
    <div className="px-[16px] pb-[4px] pt-[8px]" style={{ height: SCOPE_SWITCH_HEIGHT }}>
      <div className="relative flex rounded-[12px] border border-border bg-muted p-[3px]">
        <span
          className={cn(
            "absolute bottom-[3px] left-[3px] top-[3px] w-[calc((100%-6px)/2)] translate-x-full rounded-[10px] border border-input bg-segmented-selected",
            CARD_SHADOW,
          )}
        />
        {options.map((option) => (
          <span
            key={option.label}
            className="relative flex min-h-[34px] min-w-0 flex-1 items-center justify-center gap-[6px] px-[8px]"
          >
            <span
              className={cn(
                "truncate text-[13px] font-medium leading-[18px]",
                option.selected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {option.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** `SessionGroupHeader`: a muted bar with the group icon, the name, the count, and a chevron. */
function GroupHeader({ group }: { group: PhoneGroup }): ReactElement {
  const Icon = SESSION_GROUP_ICONS[group.id];
  return (
    <div className="px-[16px] pb-[4px] pt-[12px]" style={{ height: GROUP_HEADER_HEIGHT }}>
      <div className="flex min-h-[48px] items-center gap-[8px] rounded-[10px] bg-muted/60 px-[12px]">
        <Icon aria-hidden="true" size={16} className={SESSION_GROUP_ICON_CLASSES[group.id]} />
        <span className="flex-1 text-[13px] font-semibold leading-[18px] text-sidebar-foreground">
          {SESSION_GROUP_LABELS[group.id]}
        </span>
        <span
          className={cn(
            "flex min-h-[20px] min-w-[24px] items-center justify-center rounded-[10px] px-[7px] py-px text-[12px] font-medium leading-[16px] tracking-[0.1px] tabular-nums",
            SESSION_GROUP_COUNT_CLASSES[group.id],
          )}
        >
          {group.entries.length}
        </span>
        <ChevronDown aria-hidden="true" size={14} className="text-sidebar-muted-foreground" />
      </div>
    </div>
  );
}

/** The status dot of a row, with the running glow and ring of `RunningPulse`. */
function StatusDot({ entry }: { entry: SessionNavigationEntry }): ReactElement {
  const tone = sessionEntryDotTone(entry, false);
  const running = tone === "running";
  return (
    <span className="relative flex w-[18px] shrink-0 items-center justify-center">
      {running ? (
        <>
          <span className="absolute size-[15px] animate-[odt-task-tab-status-glow_1350ms_ease-in-out_infinite] rounded-full bg-status-running/28 motion-reduce:animate-none" />
          <span className="absolute size-[13px] animate-[odt-task-tab-status-ring_1350ms_cubic-bezier(0.16,1,0.3,1)_infinite] rounded-full border border-status-running/48 motion-reduce:hidden" />
        </>
      ) : null}
      <span className={cn("relative size-[9px] rounded-full", SESSION_DOT_CLASSES[tone])} />
    </span>
  );
}

/** `RowMetadata`: what the session asks, or the time of its last activity. */
function RowMetadata({ entry }: { entry: SessionNavigationEntry }): ReactElement | null {
  const reasons = visibleAttentionReasons(entry);
  if (reasons.length > 0) {
    return (
      <span className="flex items-center gap-[4px]">
        {reasons.map((reason) => (
          <span
            key={reason}
            className="rounded-[6px] border border-warning-border bg-warning-surface px-[6px] py-[2px] text-[11px] font-medium leading-[14px] tracking-[0.2px] text-warning-muted"
          >
            {ATTENTION_REASON_LABELS[reason]}
          </span>
        ))}
      </span>
    );
  }
  const time = entry.status.kind === "running" ? null : sessionEntryShortTime(entry, SAMPLE_NOW);
  if (!time) return null;
  return (
    <span className="text-[11px] font-medium leading-[14px] tracking-[0.2px] text-sidebar-foreground tabular-nums">
      {time}
    </span>
  );
}

/** The role icon of a task session, or the chat icon. */
function EntryIcon({ entry }: { entry: SessionNavigationEntry }): ReactElement {
  const Icon = sessionEntryIcon(entry);
  return <Icon aria-hidden="true" size={17} className={sessionEntryIconClassName(entry)} />;
}

/** `SessionRow`: the card with the workspace line and the title line. */
function SessionRow({ entry }: { entry: SessionNavigationEntry }): ReactElement {
  const task = entry.context.kind === "task" ? entry.context.task : null;
  return (
    <div
      className="py-[3px]"
      style={{ height: sessionRowHeight(entry), paddingInline: SESSION_ROW_INSET }}
    >
      <div
        className={cn(
          "flex flex-col gap-[4px] rounded-[12px] border px-[12px] py-[10px]",
          CARD_SHADOW,
          rowSurfaceClassName(entry),
        )}
      >
        <div className="flex min-w-0 items-center gap-[8px]">
          <StatusDot entry={entry} />
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px] tracking-[0.1px] text-sidebar-foreground">
            {entry.workspace.workspaceName}
          </span>
          {task ? (
            <span
              className={cn(
                "flex min-h-[22px] items-center gap-[4px] self-start rounded-full border px-[8px] text-[11px] font-semibold leading-[14px] tracking-[0.2px]",
                statusBadgeClassName(task.sharedState),
              )}
            >
              <span className="truncate">{task.sharedState.shortLabel}</span>
            </span>
          ) : null}
          <RowMetadata entry={entry} />
        </div>
        <div className="flex min-w-0 items-center gap-[8px]">
          <span className="flex w-[18px] shrink-0 items-center justify-center">
            <EntryIcon entry={entry} />
          </span>
          <span
            className={cn(
              "line-clamp-2 min-w-0 flex-1 text-[15px] font-medium leading-[22px]",
              SESSION_TITLE_CLASSES[sessionEntryTitleTone(entry, false)],
            )}
          >
            {entry.title}
          </span>
          {entry.runtimeKind ? (
            <AgentRuntimeIcon runtimeKind={entry.runtimeKind} className="size-[15px]" />
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * The Sessions tab of the mobile app on an Android phone, paired with the host: the status bar,
 * the header, the session list of every workspace, and the tab bar.
 */
function TourMobileSessionsScreen(): ReactElement {
  return (
    <div
      className="relative overflow-hidden bg-sidebar text-foreground"
      style={{ width: SCREEN_WIDTH, height: SCREEN_HEIGHT }}
    >
      <StatusBar />
      <Header />
      <ScopeSwitch />
      {PHONE_GROUPS.map((group) => (
        <section key={group.id}>
          <GroupHeader group={group} />
          {group.entries.map((entry) => (
            <SessionRow key={entry.key} entry={entry} />
          ))}
        </section>
      ))}
      <TourPhoneTabBar />
    </div>
  );
}

/** A modern Android phone: a metal rim, a thin black bezel, and the Sessions tab on its screen. */
export function TourMobilePhone(): ReactElement {
  return (
    <div
      className="t-tour-window relative bg-linear-to-b from-neutral-500 via-neutral-700 to-neutral-500"
      style={{
        width: TOUR_PHONE_SIZE.width,
        height: TOUR_PHONE_SIZE.height,
        padding: RIM,
        borderRadius: SCREEN_RADIUS + FRAME,
      }}
    >
      <div
        className="bg-black"
        style={{
          padding: BEZEL,
          borderRadius: SCREEN_RADIUS + BEZEL,
          height: "100%",
        }}
      >
        <div className="overflow-hidden" style={{ borderRadius: SCREEN_RADIUS }}>
          <TourMobileSessionsScreen />
        </div>
      </div>
    </div>
  );
}
