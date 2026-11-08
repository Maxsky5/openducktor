import type { AppPlatform } from "@openducktor/contracts";
import {
  SESSION_NAVIGATION_GROUP_ORDER,
  type SessionNavigationEntry,
  type SessionNavigationGroupId,
} from "@openducktor/frontend-core/sessions/navigation/session-navigation-read-model";
import {
  ChevronDown,
  Columns3,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { ReactElement } from "react";
import { AppBrand } from "@/components/layout/sidebar/app-brand";
import { SessionGroupingToggle } from "@/components/layout/sidebar/session-grouping-toggle";
import {
  SESSION_GROUP_HEADER_CLASS_NAME,
  SessionGroupHeaderContent,
  SessionRowContent,
} from "@/components/layout/sidebar/session-navigation-list";
import { sessionRowClassName } from "@/components/layout/sidebar/session-navigation-styles";
import { SessionScopeSwitch } from "@/components/layout/sidebar/session-scope-switch";
import { WorkspaceTile } from "@/components/layout/workspace-tile";
import { Button } from "@/components/ui/button";
import { KeyCaps } from "@/features/command-palette/command-palette-key-caps";
import { platformKeyLabels } from "@/lib/keyboard-shortcuts";
import { cn } from "@/lib/utils";
import { noop, SAMPLE_NOW, SESSIONS, WORKSPACE_LIST, WORKSPACES } from "../feature-tour-samples";
import { TOUR_FRAME_ASPECT } from "../feature-tour-geometry";
import { type FeatureTourSlide, type TourPart, TourPiece } from "../feature-tour-stage";

// Slide 2: the workspace rail and the sidebar of the desktop window. The rail and the sidebar use
// the real components of the app, or the exact markup of a part that reads app state.

const PARTS: readonly TourPart[] = [
  {
    title: "Workspace rail",
    text: "One tile for each repository. Select a tile to switch.",
    pin: { x: 6, y: 68, side: "left" },
  },
  {
    title: "Open repository",
    text: "Add another local Git repository as a workspace.",
    pin: { x: 6, y: 233, side: "left" },
  },
  {
    title: "Scope",
    text: "Show the sessions of this workspace, or of all your workspaces.",
    pin: { x: 322, y: 175, side: "right" },
  },
  {
    title: "Sessions",
    text: "The agents of the workspace: the ones that wait for you, the running ones, and the recent ones.",
    pin: { x: 384, y: 391, side: "right", span: 349 },
  },
];

/** The width of the rail and the sidebar. */
const WIDTH = 376;

/** The stage is wider than the piece, so the bracket of the Sessions pin has room beside it. */
const STAGE_WIDTH = 392;

/** The piece ends 12 app px under the last row of the sidebar. */
const HEIGHT = 578;

/**
 * The height of the window: a window 1508 app px wide at the frame ratio. The sidebar has the full
 * height, so its footer stays under the bottom edge of the piece.
 */
const WINDOW_HEIGHT = 1508 / TOUR_FRAME_ASPECT;

const GROUPS = {
  needs_you: [SESSIONS.wordCountQuestion],
  running: [SESSIONS.shortcutBuild, SESSIONS.focusQa],
  recent: [SESSIONS.titlesSpec],
} as const satisfies Record<SessionNavigationGroupId, readonly SessionNavigationEntry[]>;

/** The workspace rail. The markup of `WorkspaceRail`, without its drag and drop. */
function TourWorkspaceRail(): ReactElement {
  return (
    <aside className="flex h-full w-14 shrink-0 flex-col bg-[linear-gradient(var(--sidebar)_40px,var(--workspace-rail)_0)] pt-10">
      {WORKSPACE_LIST.map((workspace) => {
        const isActive = workspace.workspaceId === WORKSPACES.fieldnotes.workspaceId;
        return (
          <div
            key={workspace.workspaceId}
            className={cn("flex justify-center px-2 py-2", isActive && "bg-sidebar")}
          >
            <span className="relative size-10 rounded-lg">
              <WorkspaceTile workspace={workspace} size="lg" active={isActive} />
            </span>
          </div>
        );
      })}
      <div className="flex flex-col items-center px-2 py-1">
        <Button type="button" size="icon" variant="ghost" className="size-10">
          <Plus className="size-5" />
        </Button>
      </div>
    </aside>
  );
}

/** The open sidebar on the Kanban page: the markup of `WorkspaceSidebar` with the real rows. */
function TourSidebar({ modifier }: { modifier: string }): ReactElement {
  return (
    <aside className="flex h-full w-80 min-w-0 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex flex-col gap-3 border-b border-sidebar-border p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
            <AppBrand />
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1.5 border-sidebar-border bg-transparent px-2 text-sidebar-muted-foreground shadow-none"
            >
              <Search className="size-3.5" />
              <KeyCaps keys={[modifier, "K"]} />
            </Button>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="mt-0.5 size-8 shrink-0 text-sidebar-muted-foreground"
          >
            <PanelLeftClose className="size-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="flex h-9 items-center gap-2 rounded-md bg-sidebar-accent px-3 text-sm font-medium text-sidebar-accent-foreground shadow-sm">
            <Columns3 className="size-4" />
            Kanban
          </span>
          <div className="flex w-full">
            <Button
              type="button"
              className="h-9 flex-1 justify-start gap-2 rounded-r-none px-3 shadow-none"
            >
              <Plus data-icon="inline-start" />
              New task
            </Button>
            <Button
              type="button"
              className="h-9 rounded-l-none border-l border-primary-foreground/25 px-2.5 shadow-none"
            >
              <ChevronDown />
            </Button>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <SessionScopeSwitch
            scope="current"
            onScopeChange={noop}
            workspace={WORKSPACES.fieldnotes}
          />
        </div>
        <SessionGroupingToggle grouping="none" onChange={noop} disabled={false} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
        {SESSION_NAVIGATION_GROUP_ORDER.map((groupId) => {
          const entries = GROUPS[groupId];
          return (
            <section key={groupId} className="flex flex-col gap-1 pb-4">
              <span className={SESSION_GROUP_HEADER_CLASS_NAME}>
                <SessionGroupHeaderContent
                  groupId={groupId}
                  count={entries.length}
                  collapsed={false}
                />
              </span>
              <ul>
                {entries.map((entry) => (
                  <li key={entry.key} className="py-0.5">
                    <span className={sessionRowClassName(entry, false)}>
                      <SessionRowContent
                        entry={entry}
                        unread={false}
                        now={SAMPLE_NOW}
                        readStatusId={`tour-${entry.key}`}
                        commandCount={0}
                        isSelected={false}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <div className="flex items-center gap-1 border-t border-sidebar-border p-2">
        <Button
          type="button"
          variant="outline"
          className="flex-1 justify-start border-transparent bg-transparent px-3 text-sidebar-foreground shadow-none"
        >
          <Settings />
          Settings
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="size-8 border-transparent bg-transparent shadow-none"
        >
          <ShieldCheck className="size-4 text-success-accent" />
        </Button>
      </div>
    </aside>
  );
}

function WorkspacesStage({ modifier }: { modifier: string }): ReactElement {
  return (
    <TourPiece x={0} y={0} width={WIDTH} height={HEIGHT}>
      {/* The top-left corner of the desktop window: the macOS window controls over the rail. */}
      <div className="relative flex" style={{ width: WIDTH, height: WINDOW_HEIGHT }}>
        <span className="absolute left-3.5 top-[13px] z-10 flex gap-2">
          <i className="size-3 rounded-full bg-[#ff5f57]" />
          <i className="size-3 rounded-full bg-[#febc2e]" />
          <i className="size-3 rounded-full bg-[#28c840]" />
        </span>
        <TourWorkspaceRail />
        <TourSidebar modifier={modifier} />
      </div>
    </TourPiece>
  );
}

/** Slide 2. The sidebar shows the command palette keys of `platform`. */
export const workspacesSlide = (platform: AppPlatform): FeatureTourSlide => ({
  id: "workspaces",
  title: "Workspaces hold your work",
  text: "A workspace is one local Git repository, and its tasks and agent sessions stay in it. The rail switches between workspaces, and the sidebar follows the agents of the selected one.",
  explainer: {
    width: STAGE_WIDTH,
    height: HEIGHT,
    parts: PARTS,
    stage: <WorkspacesStage modifier={platformKeyLabels(platform).modifier} />,
  },
});
