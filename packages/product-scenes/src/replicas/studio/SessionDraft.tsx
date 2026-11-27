// The draft page of a new workspace session in workspace-session-draft-view.tsx. `DraftHeader` is
// the top bar: the New session title with the workspace chip and Discard, and the title of the
// first message while the session starts. `DraftStage` holds the composer: the heading with the
// workspace picker above it, and the options bar of workspace-session-draft-config-bar.tsx under
// it, with the work location, the branch of a new worktree, the target branch, and the custom
// role. While the page pane has `data-draft`, the stage centers the composer and the transcript
// hides. When the first message goes, the heading and the options hide, and the composer docks
// at the bottom of the transcript. session-draft.ts moves the page.
import {
  Bot,
  ChevronDown,
  ChevronsUpDown,
  Folder,
  FolderGit2,
  GitBranch,
  type LucideIcon,
  MessageCirclePlus,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { WORKSPACES, type WorkspaceName } from "../../sample/workspace";
import { SessionHeader } from "./SessionHeader";
import "./SessionDraft.css";

/** The work locations of a new session, by the values of workspace-session-draft-config-bar.tsx. */
export type WorkLocation = "local_repo_root" | "local_worktree" | "existing_worktree";

/** A work location: its value, its label, its description, and its icon. */
type LocationOption = { value: WorkLocation; label: string; description: string; Icon: LucideIcon };

/** LOCATION_OPTIONS of workspace-session-draft-config-bar.tsx. */
export const WORK_LOCATIONS: readonly LocationOption[] = [
  {
    value: "local_repo_root",
    label: "Current checkout",
    description: "Work directly in the repository",
    Icon: Folder,
  },
  {
    value: "local_worktree",
    label: "New worktree",
    description: "Create an isolated branch worktree",
    Icon: GitBranch,
  },
  {
    value: "existing_worktree",
    label: "Existing worktree",
    description: "Reuse another registered worktree",
    Icon: FolderGit2,
  },
];

/** The words of the draft page that the product has only in its markup. */
export const DRAFT_TEXT = {
  title: "New session",
  discard: "Discard",
  heading: "Start a new session",
  lead: "Choose where the agent works and send your first message.",
  /** The read-only reason of the composer while the session starts. */
  starting: "Starting session…",
  /** The state of the first message until the runtime has it. */
  sending: "Sending…",
  autoBranch: "Auto branch",
  noRole: "No role",
} as const;

/** The WorkspaceTile of a workspace: its initials on the color of the workspace rail. */
function WorkspaceTile({ workspace }: { workspace: WorkspaceName }): ReactElement {
  const tile = WORKSPACES.find((item) => item.name === workspace)?.tile;
  return <span className="sd-tile">{tile}</span>;
}

type DraftHeaderProps = {
  workspace: WorkspaceName;
  /** The first message, which titles the page while the session starts. */
  message: string;
};

/** The top bar of the draft page. */
export function DraftHeader({ workspace, message }: DraftHeaderProps): ReactElement {
  return (
    <SessionHeader
      title={
        <>
          <span className="sd-title" data-draft-title="">
            <MessageCirclePlus className="sd-title-icon" />
            <span className="sd-title-name">{DRAFT_TEXT.title}</span>
            <span className="sd-chip">
              <WorkspaceTile workspace={workspace} />
              <span>{workspace}</span>
            </span>
          </span>
          <span className="sh-name" hidden data-starting-title="">
            <span>{message}</span>
          </span>
        </>
      }
    >
      <span className="sd-discard" data-discard="">
        <Trash2 />
        <span>{DRAFT_TEXT.discard}</span>
      </span>
    </SessionHeader>
  );
}

/** The heading over the composer, with the inline workspace picker. */
function DraftHeading({ workspace }: { workspace: WorkspaceName }): ReactElement {
  return (
    <div className="sd-heading">
      <div className="sd-heading-row">
        <h2>{DRAFT_TEXT.heading}</h2>
        <span className="sd-in">
          <span>in</span>
          <span className="sd-picker">
            <WorkspaceTile workspace={workspace} />
            <span>{workspace}</span>
            <ChevronsUpDown />
          </span>
        </span>
      </div>
      <p>{DRAFT_TEXT.lead}</p>
    </div>
  );
}

/** A quiet trigger of the options bar with its icon inside the left padding. */
function InsetTrigger({ Icon, label }: { Icon: LucideIcon; label: string }): ReactElement {
  return (
    <span className="sd-trigger sd-inset">
      <Icon className="sd-lead" />
      <span className="sd-value">
        <span>{label}</span>
      </span>
      <ChevronsUpDown className="sd-chevrons" />
    </span>
  );
}

type DraftOptionsProps = {
  location: WorkLocation;
  /** The selected target branch. */
  target: string;
};

/**
 * The options bar. The location trigger holds each location and shows the selected one, and New
 * worktree shows the branch trigger after a separator.
 */
function DraftOptions({ location, target }: DraftOptionsProps): ReactElement {
  const worktree = location === "local_worktree";
  return (
    <section className="sd-options">
      <div className="sd-left">
        <span className="sd-trigger" data-location-trigger="">
          <span className="sd-value">
            {WORK_LOCATIONS.map(({ value, label, Icon }) => (
              <span
                className="sd-choice"
                hidden={value !== location}
                data-location-value={value}
                key={value}
              >
                <Icon />
                <span>{label}</span>
              </span>
            ))}
          </span>
          <ChevronsUpDown className="sd-chevrons" />
        </span>
        <span className="sd-sep" hidden={!worktree} data-branch-part="" />
        <span
          className="sd-trigger sd-branch"
          hidden={!worktree}
          data-branch-part=""
          data-branch-trigger=""
        >
          <Sparkles />
          <span>{DRAFT_TEXT.autoBranch}</span>
          <ChevronDown />
        </span>
      </div>
      <div className="sd-right">
        <InsetTrigger Icon={GitBranch} label={target} />
        <InsetTrigger Icon={Bot} label={DRAFT_TEXT.noRole} />
      </div>
    </section>
  );
}

type DraftStageProps = DraftOptionsProps & {
  workspace: WorkspaceName;
  /** The composer of the draft. */
  children: ReactNode;
};

/** The composer with the heading above it and the options bar under it. */
export function DraftStage({
  workspace,
  location,
  target,
  children,
}: DraftStageProps): ReactElement {
  return (
    <div className="sd-stage">
      <DraftHeading workspace={workspace} />
      <div className="sd-dock" data-dock="">
        {children}
      </div>
      <DraftOptions location={location} target={target} />
    </div>
  );
}
