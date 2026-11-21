import type { WorkflowLibraryRole, WorkflowRoleDefinition } from "@openducktor/contracts";
import { elementKey } from "@openducktor/workflows";
import {
  ArrowRight,
  Bot,
  Copy,
  Eye,
  FilePen,
  FileText,
  Pencil,
  Plus,
  Replace,
  RotateCcw,
} from "lucide-react";
import { type ReactElement, useState } from "react";
import { cn } from "@/lib/utils";
import { eventNames } from "../model/document-elements";
import { withOptional } from "../model/document-edits";
import { LINK_BUTTON_CLASS } from "../panels/new-element-button";
import { FILE_ACCESS_OPTIONS, TOOL_GROUPS, TOOL_LABELS } from "../../roles/role-tools";
import { FIELD_LABEL_CLASS } from "./field-shell";
import { SelectField } from "./reference-fields";
import { useInspector } from "./inspector-context";
import { ChipsField } from "./toggle-chips";
import { InspectorSection } from "./inspector-section";
import { MoreRules } from "./more-rules";
import { useElementEdit } from "./use-element-edit";

/** The access of a role in plain words. */
const accessText = (role: WorkflowLibraryRole["role"]): string => {
  return (
    FILE_ACCESS_OPTIONS.find(({ value }) => value === role.workspaceAccess)?.label ??
    role.workspaceAccess
  );
};

/** The tools that a group shows before its "more" button. */
const SHOWN_TOOLS = 6;

/** One tool group of a role: its count, and its tools as small chips. */
function ToolGroup({ title, total, tools }: { title: string; total: number; tools: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? tools : tools.slice(0, SHOWN_TOOLS);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className={cn("flex-1", FIELD_LABEL_CLASS)}>{title}</span>
        <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">
          {tools.length} / {total}
        </span>
      </div>
      {tools.length === 0 ? (
        <span className="text-xs text-muted-foreground">None</span>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {shown.map((tool) => (
            <li
              key={tool}
              className="rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-xs text-foreground/85"
            >
              {tool}
            </li>
          ))}
          {tools.length > SHOWN_TOOLS ? (
            <li>
              <button
                type="button"
                className={cn(LINK_BUTTON_CLASS, "py-0.5")}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "Show less" : `+${tools.length - SHOWN_TOOLS} more`}
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

/**
 * What the role card says. A read-only view shows the role as it is now: a version keeps the
 * role ID, and the tools come from the role.
 */
const roleProfileText = (source: WorkflowLibraryRole["source"], readOnly: boolean): string => {
  if (source === "builtin")
    return "A built-in role. Duplicate it to change its tools or instructions.";
  if (readOnly) return "The role as it is now. Every workflow that uses it gets its changes.";
  return "Changes to this role apply to every workflow that uses it.";
};

/** The catalog role: its access, its tools, and the commands that change it. */
function RoleProfile({ entry }: { entry: WorkflowLibraryRole }): ReactElement {
  const { roles, readOnly } = useInspector();
  const granted = new Set(entry.role.tools);
  const writes = entry.role.workspaceAccess === "write";
  return (
    <InspectorSection
      title="Tools and files"
      Icon={Bot}
      color="emerald"
      description={roleProfileText(entry.source, readOnly)}
      actions={
        <span className="mt-0.5 shrink-0 rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
          {entry.source === "builtin" ? "Built-in" : "Custom"}
        </span>
      }
    >
      <div className="flex items-center gap-2">
        <span className={cn("flex-1", FIELD_LABEL_CLASS)}>Files</span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            writes
              ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : "bg-muted text-muted-foreground",
          )}
        >
          {writes ? <FilePen className="size-3" /> : <Eye className="size-3" />}
          {accessText(entry.role)}
        </span>
      </div>
      {TOOL_GROUPS.map((group) => (
        <ToolGroup
          key={group.title}
          title={group.title}
          total={group.tools.length}
          tools={group.tools.filter((tool) => granted.has(tool)).map((tool) => TOOL_LABELS[tool])}
        />
      ))}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border/70 pt-3">
        {entry.source === "custom" && !readOnly ? (
          <button
            type="button"
            className={LINK_BUTTON_CLASS}
            onClick={() => roles.editRole(entry.role.id)}
          >
            <Pencil aria-hidden="true" className="size-3.5" />
            Edit the role
          </button>
        ) : null}
        <button
          type="button"
          className={LINK_BUTTON_CLASS}
          onClick={() => roles.duplicateRole(entry.role.id)}
        >
          <Copy aria-hidden="true" className="size-3.5" />
          Duplicate the role
        </button>
      </div>
    </InspectorSection>
  );
}

/** The transitions whose reset clears the sessions of the role. A click opens one. */
function RoleResets({ roleId }: { roleId: string }): ReactElement | null {
  const { document, select, catalogRoles } = useInspector();
  const definition = document.definition;
  const resets = definition.events.filter((event) =>
    event.effects?.some(
      (effect) => effect.id === "worktree.reset" && effect.clearsSessionsOf.includes(roleId),
    ),
  );
  if (resets.length === 0) return null;
  const names = eventNames(
    definition,
    new Map(catalogRoles.map(({ role }) => [role.id, role.label])),
  );
  return (
    <InspectorSection title="Resets" Icon={RotateCcw} color="rose">
      <ul className="flex flex-col gap-1">
        {resets.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              className={LINK_BUTTON_CLASS}
              onClick={() => select(elementKey("event", event.id))}
            >
              {names.get(event.id) ?? event.id}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </InspectorSection>
  );
}

/** A role that the workflow binds: its catalog role, what it may save here, and its swap. */
export function RoleInspector({ binding }: { binding: WorkflowRoleDefinition }): ReactElement {
  const { document, rename, options, catalogRoles, roles, readOnly, problemPaths } = useInspector();
  const { edit } = useElementEdit("role", binding.id);
  const entry = catalogRoles.find(({ role }) => role.id === binding.id);
  const bound = new Set(document.definition.roles.map(({ id }) => id));
  const otherRoles = options.catalogRoles.filter(
    ({ value }) => value === binding.id || !bound.has(value),
  );

  return (
    <>
      {entry ? (
        <RoleProfile entry={entry} />
      ) : (
        <div className="flex shrink-0 flex-col gap-2 rounded-xl border border-destructive-border bg-destructive-surface p-3.5 text-sm text-destructive-surface-foreground">
          {readOnly
            ? `The role "${binding.id}" does not exist on this computer.`
            : `The role "${binding.id}" does not exist on this computer. Create it, or pick another role under Swap this role.`}
          {readOnly ? null : (
            <button type="button" className={LINK_BUTTON_CLASS} onClick={roles.newRole}>
              <Plus aria-hidden="true" className="size-3.5" />
              Create a role
            </button>
          )}
        </div>
      )}

      <InspectorSection title="Documents" Icon={FileText} color="rose">
        <ChipsField
          label="Can save"
          emptyText="No artifact yet. Add one under Artifacts in the element list."
          Icon={FileText}
          color="rose"
          path={["writes"]}
          values={binding.writes}
          options={options.artifacts}
          onChange={(writes) => edit((current) => ({ ...current, writes }))}
        />
        <SelectField
          label="Shown first"
          path={["defaultArtifact"]}
          value={binding.defaultArtifact}
          noneLabel="First step output"
          options={options.artifacts}
          onChange={(defaultArtifact) =>
            edit((current) => withOptional(current, "defaultArtifact", defaultArtifact))
          }
        />
      </InspectorSection>

      <RoleResets roleId={binding.id} />

      {readOnly ? null : (
        <MoreRules
          title="Swap this role"
          Icon={Replace}
          active={entry === undefined || problemPaths.has("id")}
          roots={["id"]}
        >
          <SelectField
            label="Swap for"
            path={["id"]}
            value={binding.id}
            options={otherRoles}
            onChange={(next) => next && rename("role", binding.id, next)}
          />
        </MoreRules>
      )}
    </>
  );
}
