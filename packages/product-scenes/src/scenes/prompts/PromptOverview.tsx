// The prompt screens of settings-prompt-home.tsx and settings-prompt-workflow-page.tsx in
// packages/frontend/src/components/features/settings: the first screen with the role instructions
// and the workflows, then the page of the Spec, Plan, Build workflow.
import { ChevronRight, ListFilter, Search, Workflow } from "lucide-react";
import type { ReactElement } from "react";
import { flag } from "../../replicas/flag";
import { RoleIcon } from "../../replicas/ui/RoleIcon";
import { Badge } from "../../replicas/ui/Badge";
import { Button } from "../../replicas/ui/Button";
import { ROLE_LABELS } from "../../replicas/vocabulary";
import { PromptCrumbs } from "./PromptCrumbs";
import { type PromptGroup, QA_KICKOFF_CARD, ROLE_PROMPTS, WORKFLOW_SECTION } from "./sample";
import "./PromptOverview.css";

function Group({ group }: { group: PromptGroup }): ReactElement {
  return (
    <div className="po-group">
      <div className="po-group-head">
        <strong>{group.title}</strong>
        <span>{group.description}</span>
      </div>
      <ul className="po-rows">
        {group.rows.map((row) => (
          <li
            className="po-row"
            key={row.label}
            data-target={flag(row.label === QA_KICKOFF_CARD.label)}
          >
            <span className="po-text">
              <span className="po-label">{row.label}</span>
              <span className="po-detail">{row.description}</span>
            </span>
            {row.roles.map((role) => (
              <Badge className="po-chip" key={role}>
                <RoleIcon role={role} className="i12" />
                {ROLE_LABELS[role]}
              </Badge>
            ))}
            <ChevronRight className="i16 po-chevron" />
          </li>
        ))}
      </ul>
    </div>
  );
}

const PROMPT_COUNT = WORKFLOW_SECTION.groups.reduce((count, group) => count + group.rows.length, 0);

/** The first screen: the search, the role instructions, and the workflows. */
function Home(): ReactElement {
  return (
    <div className="po-screen" data-home="">
      <div className="po-head">
        <strong>System prompts</strong>
        <p>
          OpenDucktor sends these prompts to your agents. Open a prompt to add your instructions
          after it or to replace it. Changes apply in every repository. Repository prompts add to
          them.
        </p>
      </div>
      <div className="po-toolbar">
        <span className="po-search">
          <Search className="i16" />
          Search all prompts
        </span>
        <Button variant="outline" className="po-filter">
          <ListFilter className="i16" />
          Changed only
        </Button>
      </div>
      <div className="po-group">
        <div className="po-group-head">
          <strong>Agent roles</strong>
          <span>
            Each session of a role starts with its instructions. A change applies to the role in
            every workflow.
          </span>
        </div>
        <ul className="po-rows">
          {ROLE_PROMPTS.map(({ role, description }) => (
            <li className="po-row" key={role}>
              <RoleIcon role={role} className="i16" />
              <span className="po-text">
                <span className="po-label">{ROLE_LABELS[role]}</span>
                <span className="po-detail">{description}</span>
              </span>
              <ChevronRight className="i16 po-chevron" />
            </li>
          ))}
        </ul>
      </div>
      <div className="po-group">
        <div className="po-group-head">
          <strong>Workflows</strong>
          <span>
            Each workflow has rules for its sessions and messages that start its steps. Open a
            workflow to see its prompts.
          </span>
        </div>
        <ul className="po-rows">
          <li className="po-row" data-workflow-target="">
            <Workflow className="i16" />
            <span className="po-text">
              <span className="po-label">{WORKFLOW_SECTION.title}</span>
              <span className="po-detail">{PROMPT_COUNT} prompts</span>
            </span>
            <ChevronRight className="i16 po-chevron" />
          </li>
        </ul>
      </div>
    </div>
  );
}

/** The page of the Spec, Plan, Build workflow. */
function WorkflowPage(): ReactElement {
  return (
    <div className="po-screen" hidden data-workflow-page="">
      <div className="po-head">
        <PromptCrumbs backTitle="System prompts" title={WORKFLOW_SECTION.title} />
        <p>{WORKFLOW_SECTION.description}</p>
      </div>
      {WORKFLOW_SECTION.groups.map((group) => (
        <Group group={group} key={group.title} />
      ))}
    </div>
  );
}

/** The first screen and the workflow page, before the visitor opens the QA Kickoff prompt. */
export function PromptOverview(): ReactElement {
  return (
    <div className="po" hidden data-overview="">
      <Home />
      <WorkflowPage />
    </div>
  );
}
