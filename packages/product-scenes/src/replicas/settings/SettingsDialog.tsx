// The Settings dialog of settings-modal.tsx over a window: the header, the section menu of
// SettingsSidebar in settings-modal-sidebars.tsx, the panes of the sections that a scene shows, and
// the footer of settings-modal-footer.tsx. The window is at least md wide, so the menu is a column
// of buttons. The static frame shows the pane of `section`, and settings-dialog.ts shows one pane
// at a time.
import {
  Bell,
  Columns3,
  Cpu,
  FolderGit2,
  Keyboard,
  LoaderCircle,
  type LucideIcon,
  MessageSquare,
  MessageSquarePlus,
  MessageSquareText,
  Palette,
  Radio,
  Save,
  SlidersHorizontal,
  Workflow,
  X,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../ui/Button";
import "../studio/StartDialog.css";
import "./SettingsDialog.css";

/**
 * The sections of SETTINGS_SECTIONS in settings-modal-constants.ts, in their order, with their
 * icons. The desktop app has remote access, so the menu shows Remote control.
 */
export const SETTINGS_SECTIONS = [
  { label: "General", Icon: SlidersHorizontal },
  { label: "Keyboard shortcuts", Icon: Keyboard },
  { label: "Appearance", Icon: Palette },
  { label: "Remote control", Icon: Radio },
  { label: "Git", Icon: FolderGit2 },
  { label: "Agent runtimes", Icon: Cpu },
  { label: "Repositories", Icon: FolderGit2 },
  { label: "System prompts", Icon: MessageSquareText },
  { label: "Reusable prompts", Icon: MessageSquarePlus },
  { label: "Custom agent roles", Icon: MessageSquareText },
  { label: "Sessions", Icon: MessageSquare },
  { label: "Notifications", Icon: Bell },
  { label: "Kanban", Icon: Columns3 },
  { label: "Autopilot", Icon: Workflow },
] as const satisfies readonly { label: string; Icon: LucideIcon }[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["label"];

/** The words of the dialog: settings-modal.tsx and settings-modal-footer.tsx. */
export const SETTINGS_TEXT = {
  title: "Settings",
  description: "Manage your agents, workspaces and app preferences.",
  cancel: "Cancel",
  save: "Save settings",
  saving: "Saving…",
} as const;

type SettingsDialogProps = {
  /** The section that the menu selects and whose pane shows in the static frame. */
  section: SettingsSection;
  /** The pane of each section that the scene shows. */
  panes: Partial<Record<SettingsSection, ReactNode>>;
};

export function SettingsDialog({ section, panes }: SettingsDialogProps): ReactElement {
  return (
    <div className="st-overlay" data-settings-dialog="">
      <div className="set-dialog" data-dialog-box="">
        <div className="set-dialog-head">
          <b>{SETTINGS_TEXT.title}</b>
          <p>{SETTINGS_TEXT.description}</p>
        </div>
        <div className="set-dialog-body">
          <div className="set-menu">
            {SETTINGS_SECTIONS.map(({ label, Icon }) => (
              <Button
                variant={label === section ? "accent" : "ghost"}
                className="set-menu-item"
                data-settings-menu={label}
                key={label}
              >
                <span className="set-menu-label">
                  <Icon />
                  <span>{label}</span>
                </span>
              </Button>
            ))}
          </div>
          <div className="set-dialog-pane">
            {Object.entries(panes).map(([label, pane]) => (
              <div
                className="set-section"
                hidden={label !== section}
                data-settings-section={label}
                key={label}
              >
                {pane}
              </div>
            ))}
          </div>
        </div>
        <div className="set-dialog-foot">
          <Button variant="outline" data-settings-cancel="">
            {SETTINGS_TEXT.cancel}
          </Button>
          <Button className="set-save" data-settings-save="">
            <Save className="ui-idle-icon" />
            <LoaderCircle className="ui-busy-icon spin" />
            <span className="set-save-label">{SETTINGS_TEXT.save}</span>
            <span className="set-saving-label">{SETTINGS_TEXT.saving}</span>
          </Button>
        </div>
        <span className="set-close">
          <X />
        </span>
      </div>
    </div>
  );
}
