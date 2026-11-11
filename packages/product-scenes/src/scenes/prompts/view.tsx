// The Settings dialog on the System prompts list and the editor of the QA Kickoff prompt. Sources:
// settings-modal.tsx, settings-modal-sidebars.tsx, settings-prompt-home.tsx,
// settings-prompt-rows.tsx, settings-prompt-workflow-page.tsx, settings-prompt-page-header.tsx,
// settings-prompt-layer-editor.tsx, settings-prompt-text-field.tsx, settings-prompt-final-text.tsx,
// and settings-modal-footer.tsx in packages/frontend/src/components/features/settings, and
// workflow-prompt-settings.ts in packages/frontend-core/src/queries. The markup
// holds the frame before the save: the append instructions are on and show in the final text.
import {
  Bell,
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
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import type { ReactElement } from "react";
import { SceneFrame, type SceneViewProps } from "../../frame/SceneFrame";
import { flag } from "../../replicas/flag";
import { SettingsPane } from "../../replicas/settings/SettingsPane";
import { Pointer } from "../../replicas/shell/Pointer";
import { Badge } from "../../replicas/ui/Badge";
import { Button } from "../../replicas/ui/Button";
import { Switch } from "../../replicas/ui/Switch";
import {
  ACTIVE_SECTION,
  APPEND_TEXT,
  LAYER_LABELS,
  QA_KICKOFF,
  QA_KICKOFF_CARD,
  QA_KICKOFF_PLACEHOLDERS,
  SECTION_LABELS,
  type SectionLabel,
  STATUS_LABELS,
} from "./sample";
import { PromptOverview } from "./PromptOverview";
import { PromptCrumbs } from "./PromptCrumbs";
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

function SectionNav(): ReactElement {
  return (
    <div className="pd-nav">
      {SECTION_LABELS.map((label) => {
        const Icon = SECTION_ICONS[label];
        return (
          <span className="pd-nav-item" data-active={flag(label === ACTIVE_SECTION)} key={label}>
            <span className="pd-nav-label">
              <Icon className="i16" />
              <span>{label}</span>
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** The text of a final text part, with each placeholder marked as the app marks it. */
function MarkedText({ text }: { text: string }): ReactElement {
  return (
    <>
      {text.split(/({{[a-zA-Z.]+}})/).map((piece, index) =>
        index % 2 === 1 ? (
          <mark className="pd-mark" key={piece}>
            {piece}
          </mark>
        ) : (
          piece
        ),
      )}
    </>
  );
}

/**
 * The editor of the QA Kickoff prompt with the typed append instructions. The pane is scrolled to
 * its end, so it shows the final text.
 */
function Editor(): ReactElement {
  return (
    <div className="pd-editor" data-editor="" data-scrolled="">
      <div className="pd-editor-inner" data-editor-inner="">
        <div className="pd-title">
          <PromptCrumbs backTitle={QA_KICKOFF_CARD.owner} title={QA_KICKOFF_CARD.label}>
            <Badge variant="success" data-badge-appended="">
              {STATUS_LABELS.appended}
            </Badge>
          </PromptCrumbs>
          <p>
            {QA_KICKOFF_CARD.description} {QA_KICKOFF_CARD.usage}. Your changes apply to every task
            of {QA_KICKOFF_CARD.owner}, in every repository.
          </p>
        </div>
        <div className="pd-card">
          <div className="pd-card-head">
            <div>
              <strong>Append instructions</strong>
              <p>Add your own rules after this prompt. The built-in text keeps its updates.</p>
            </div>
            <span className="pd-enable" data-append-controls="">
              <Switch checked />
              <span className="pd-remove">
                <Trash2 className="i14" />
                Remove append
              </span>
            </span>
          </div>
          <div className="pd-textarea" data-textarea="">
            <pre>
              <span data-typed="">{APPEND_TEXT}</span>
              <i className="pd-caret" data-caret="" />
            </pre>
            <span className="pd-placeholder" hidden data-placeholder="">
              For example: Run the linter before you finish.
            </span>
          </div>
          <div className="pd-chips">
            <span>Insert a placeholder</span>
            {QA_KICKOFF_PLACEHOLDERS.map((name) => (
              <Button variant="outline" size="sm" className="pd-chip" key={name}>
                {name}
              </Button>
            ))}
          </div>
        </div>
        <div className="pd-replace">
          <div>
            <strong>Replace the whole prompt</strong>
            <p>
              Write the whole prompt yourself. A replaced prompt does not get built-in updates, so
              use append instructions when you can.
            </p>
          </div>
          <Button variant="outline" size="sm">
            Replace
          </Button>
        </div>
        <div className="pd-final">
          <strong>Final text</strong>
          <p>
            What the agent receives. OpenDucktor fills the marked placeholders when it sends the
            prompt.
          </p>
          <div className="pd-parts">
            <div className="pd-part">
              <Badge>{LAYER_LABELS.builtin}</Badge>
              <pre>
                <MarkedText text={QA_KICKOFF} />
              </pre>
            </div>
            <div className="pd-part" data-user="" data-append-part="">
              <Badge variant="success">{LAYER_LABELS.global_append}</Badge>
              <pre data-append-preview="">{APPEND_TEXT}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PromptsView(props: SceneViewProps): ReactElement {
  return (
    <SceneFrame
      {...props}
      name="prompts"
      alt="The Settings dialog on System prompts. The first screen lists the role instructions and the workflows. The visitor opens the Spec, Plan, Build workflow, then its QA Kickoff prompt. The visitor types append instructions. The append turns on, the prompt gets the Appended badge, and the final text shows the built-in prompt and then the global append. The visitor saves the settings."
    >
      <SettingsPane className="prompts-dialog" data-prompts>
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
            <PromptOverview />
            <Editor />
          </div>
        </div>
        <div className="pd-footer">
          <Button variant="outline" data-cancel>
            Cancel
          </Button>
          <span className="pd-message" />
          <Button className="pd-save" data-save>
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
