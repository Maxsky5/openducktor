// The Settings dialog on the global prompt overrides of the QA role. Sources: settings-modal.tsx,
// settings-modal-sidebars.tsx, settings-prompt-overrides-section.tsx,
// settings-modal-prompt-components.tsx, and settings-modal-footer.tsx in
// packages/frontend/src/components/features/settings. The markup holds the last frame of the
// error: the new line uses {{task.type}}, which is not a placeholder of OpenDucktor.
import {
  Bell,
  ChevronDown,
  CircleAlert,
  Columns3,
  Cpu,
  FolderGit2,
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
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { flag } from "../../replicas/flag";
import { SettingsPane } from "../../replicas/settings/SettingsPane";
import { Pointer } from "../../replicas/shell/Pointer";
import { Button } from "../../replicas/ui/Button";
import { Segment } from "../../replicas/ui/Segment";
import { Segmented } from "../../replicas/ui/Segmented";
import { Switch } from "../../replicas/ui/Switch";
import {
  ACTIVE_SECTION,
  ACTIVE_TAB,
  ADDED_LINE,
  PROMPT_TABS,
  QA_BASE_AFTER,
  QA_BASE_BEFORE,
  QA_BASE_CARD,
  QA_KICKOFF,
  QA_KICKOFF_CARD,
  SECTION_LABELS,
  type SectionLabel,
  unsupported,
} from "./sample";
import "./view.css";

/** The icon of each section, as SETTINGS_SECTIONS gives it. */
const SECTION_ICONS = {
  General: SlidersHorizontal,
  Appearance: Palette,
  "Remote control": Radio,
  Git: FolderGit2,
  "Agent runtimes": Cpu,
  Repositories: FolderGit2,
  "System prompts": MessageSquareText,
  "Reusable prompts": MessageSquarePlus,
  "Custom agent roles": MessageSquareText,
  Sessions: MessageSquare,
  Notifications: Bell,
  Kanban: Columns3,
  Autopilot: Workflow,
} satisfies Record<SectionLabel, LucideIcon>;

/** The sections of the dialog. The active section shows the placeholder error. */
function SectionNav(): ReactElement {
  return (
    <div className="pd-nav">
      {SECTION_LABELS.map((label) => {
        const Icon = SECTION_ICONS[label];
        const active = label === ACTIVE_SECTION;
        return (
          <span className="pd-nav-item" data-active={flag(active)} key={label}>
            <span className="pd-nav-label">
              <Icon className="i16" />
              <span>{label}</span>
            </span>
            {active && <CircleAlert className="i14 pd-alert" data-alert />}
          </span>
        );
      })}
    </div>
  );
}

type Card = { label: string; owner: string; description: string };

/** The heading of a prompt card, with its owner, and its Enable override switch. */
function CardHead({ card, checked }: { card: Card; checked: boolean }): ReactElement {
  return (
    <div className="pd-card-head">
      <div>
        <strong>{card.label}</strong>
        <p className="pd-owner">{card.owner}</p>
        <p>{card.description}</p>
      </div>
      <span className="pd-enable">
        {checked ? <Switch checked data-switch /> : <Switch />}
        Enable override
      </span>
    </div>
  );
}

/** The row of the inherited prompt, for a card without an override. */
function Inherited({ hidden = false }: { hidden?: boolean }): ReactElement {
  return (
    <div className="pd-inherited" hidden={hidden} data-inherited={flag(hidden)}>
      <p>Inherited prompt in use: Built-in prompt</p>
      <ChevronDown className="i14" />
    </div>
  );
}

/** The QA Role Base card with the override on and the new line with the wrong key. */
function BaseCard(): ReactElement {
  return (
    <div className="pd-card">
      <CardHead card={QA_BASE_CARD} checked />
      <Inherited hidden />
      <div className="pd-editor">
        <span className="pd-label">Override prompt</span>
        <div className="pd-textarea" data-textarea="">
          <pre>
            {QA_BASE_BEFORE}
            <span data-part="lead">{ADDED_LINE.lead}</span>
            <span data-part="key">{ADDED_LINE.wrongKey}</span>
            <span data-part="close">{ADDED_LINE.close}</span>
            <span data-part="tail">{ADDED_LINE.tail}</span>
            <i className="pd-caret" data-caret="" />
            {QA_BASE_AFTER}
          </pre>
        </div>
        <p className="pd-error" data-error="">
          {unsupported(ADDED_LINE.wrongKey)}
        </p>
      </div>
      <div className="pd-actions">
        <Button variant="ghost" size="sm" data-clear>
          Clear override
        </Button>
      </div>
    </div>
  );
}

/** The QA Kickoff card without an override. */
function KickoffCard(): ReactElement {
  return (
    <div className="pd-card">
      <CardHead card={QA_KICKOFF_CARD} checked={false} />
      <Inherited />
      <div className="pd-editor">
        <span className="pd-label">Override prompt</span>
        <div className="pd-textarea">
          <pre>{QA_KICKOFF}</pre>
        </div>
      </div>
      <div className="pd-actions">
        <Button variant="ghost" size="sm" data-disabled>
          Clear override
        </Button>
      </div>
    </div>
  );
}

export function PromptsView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="prompts"
      alt="The Settings dialog on the global prompt overrides of the QA role. The visitor turns on the override of the QA Role Base prompt and adds a line with the placeholder {{task.type}}. OpenDucktor shows that the placeholder is not supported and disables Save. The visitor changes it to {{task.issueType}} and saves the settings."
    >
      <SettingsPane className="prompts-dialog" data-prompts data-invalid>
        <div className="pd-header">
          <strong>Settings</strong>
          <p>Manage your agents, workspaces and app preferences.</p>
          <span className="pd-close">
            <X className="i16" />
          </span>
        </div>
        <div className="pd-body">
          <SectionNav />
          <div className="pd-content">
            <div className="pd-heading">
              <strong>Global prompt overrides</strong>
              <p>
                These prompts apply to every repository. An enabled repository override takes
                priority.
              </p>
            </div>
            <Segmented size="sm">
              {PROMPT_TABS.map((tab) => (
                <Segment className="pd-tab" active={tab === ACTIVE_TAB} key={tab}>
                  <span>{tab}</span>
                  {tab === ACTIVE_TAB && <CircleAlert className="i14" data-alert />}
                </Segment>
              ))}
            </Segmented>
            <p className="pd-banner" data-banner="">
              1 prompt placeholder error in this tab.
            </p>
            <div className="pd-cards">
              <BaseCard />
              <KickoffCard />
            </div>
          </div>
        </div>
        <div className="pd-footer">
          <Button variant="outline" data-cancel>
            Cancel
          </Button>
          <span className="pd-message">
            <span data-message="">1 prompt placeholder error.</span>
          </span>
          <Button className="pd-save" data-disabled data-save>
            <Save className="i16 pd-save-icon" />
            <LoaderCircle className="i16 spin pd-saving-icon" />
            <span data-save-label="">Save settings</span>
          </Button>
        </div>
        <Pointer />
      </SettingsPane>
    </SceneFrame>
  );
}
