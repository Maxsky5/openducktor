import { Bot, GitPullRequest, Tag } from "lucide-react";
import {
  ISSUE_TYPE_VALUES,
  type IssueType,
  workflowIconSchema,
  type WorkflowIssueTypeDefinition,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import { issueTypeStyle } from "@/components/features/kanban/kanban-task-badge-model";
import { cn } from "@/lib/utils";
import {
  BUILTIN_ISSUE_TYPES,
  ISSUE_TYPE_ORDER,
  setIssueTypeSupported,
  updateDefinition,
  withOptional,
} from "../model/document-edits";
import { fieldCoalesceKey, useInspector } from "./inspector-context";
import { ChipsField } from "./toggle-chips";
import { iconOptions, vocabularyOptions } from "./element-options";
import { SelectField } from "./reference-fields";
import { IdField, OptionalTextField, TextField } from "./text-fields";
import { InspectorSection } from "./inspector-section";
import { MoreRules } from "./more-rules";
import { useElementEdit } from "./use-element-edit";

const idHint = (published: boolean, readOnly: boolean): string | undefined => {
  if (readOnly) return undefined;
  if (published) return "You cannot change the ID after the first publication.";
  return "Each workflow needs its own ID. You cannot change it after the first publication.";
};

/** The design system icon of an issue type, in its colour. */
export function IssueTypeIcon({
  issueType,
}: {
  issueType: { id: string; label: string; icon?: WorkflowIssueTypeDefinition["icon"] };
}): ReactElement {
  // A type without its own icon takes the icon of the built-in type with its ID, such as bug.
  const fallback = workflowIconSchema.safeParse(issueType.id);
  const icon = issueType.icon ?? (fallback.success ? fallback.data : undefined);
  const { icon: Icon, iconClassName } = issueTypeStyle(
    icon === undefined ? issueType : { ...issueType, icon },
  );
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", iconClassName)} />;
}

/** The label of each supported issue type, by ID. */
const issueTypeLabels = (
  issueTypes: readonly WorkflowIssueTypeDefinition[],
): Partial<Record<IssueType, string>> =>
  Object.fromEntries(issueTypes.map(({ id, label }) => [id, label || id]));

/** The workflow name, ID, issue types, and pull request roles. */
export function WorkflowInspector(): ReactElement {
  const {
    document,
    change,
    elementKey,
    options,
    published,
    takenWorkflowIds,
    readOnly,
    problemPaths,
  } = useInspector();
  const definition = document.definition;
  const editDefinition = (
    update: Parameters<typeof updateDefinition>[1],
    path?: (string | number)[],
  ) =>
    change(
      (current) => updateDefinition(current, update),
      path ? { coalesceKey: fieldCoalesceKey(elementKey, path) } : {},
    );
  const supported = definition.issueTypes.map(({ id }) => id);
  // A supported type keeps its own look. Another type shows the look of the built-in one.
  const issueTypeOf = (id: string) =>
    definition.issueTypes.find((issueType) => issueType.id === id) ??
    [...BUILTIN_ISSUE_TYPES.values()].find((issueType) => issueType.id === id) ?? { id, label: id };
  const firstSupported = definition.issueTypes[0];

  return (
    <>
      <InspectorSection>
        <TextField
          label="Name"
          path={["label"]}
          value={definition.label}
          onChange={(label) => editDefinition((value) => ({ ...value, label }), ["label"])}
        />
      </InspectorSection>

      <InspectorSection
        title="Issue types"
        description="The built-in types that new tasks of this workflow can pick."
        Icon={Tag}
        color="teal"
      >
        <ChipsField
          label="Supported types"
          Icon={Tag}
          color="teal"
          leading={(id) => <IssueTypeIcon issueType={issueTypeOf(id)} />}
          path={["issueTypes"]}
          values={supported}
          options={vocabularyOptions(ISSUE_TYPE_ORDER, issueTypeLabels(definition.issueTypes))}
          onChange={(next) =>
            change((current) => {
              let result = current;
              for (const issueType of ISSUE_TYPE_VALUES)
                result = setIssueTypeSupported(result, issueType, next.includes(issueType));
              return result;
            })
          }
        />
        <SelectField
          label="Default type"
          path={["defaultIssueType"]}
          // Without a default, new tasks take the first supported type, so that type stores nothing.
          value={definition.defaultIssueType ?? firstSupported?.id}
          options={definition.issueTypes.map((issueType) => ({
            value: issueType.id,
            label: issueType.label || issueType.id,
            icon: <IssueTypeIcon issueType={issueType} />,
          }))}
          onChange={(defaultIssueType) =>
            editDefinition((value) =>
              withOptional(
                value,
                "defaultIssueType",
                defaultIssueType === value.issueTypes[0]?.id ? undefined : defaultIssueType,
              ),
            )
          }
        />
      </InspectorSection>

      <InspectorSection title="Pull request" Icon={GitPullRequest} color="emerald">
        <ChipsField
          label="Allowed roles"
          Icon={Bot}
          color="emerald"
          path={["pullRequestRoles"]}
          values={definition.pullRequestRoles}
          options={options.boundRoles}
          // A value, not a hint: without roles, every role can open the pull request.
          emptyText={
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 text-xs font-medium text-foreground">
              <Bot aria-hidden="true" className="size-3 text-muted-foreground" />
              Every role
            </span>
          }
          hint={
            options.boundRoles.length > 0 && definition.pullRequestRoles.length === 0
              ? "None picked: every role can."
              : undefined
          }
          onChange={(pullRequestRoles) =>
            editDefinition((value) => ({ ...value, pullRequestRoles }))
          }
        />
      </InspectorSection>

      <MoreRules title="Advanced" active={problemPaths.has("id")} roots={["id"]}>
        <IdField
          label="Workflow ID"
          path={["id"]}
          value={definition.id}
          taken={takenWorkflowIds}
          fixed={published || readOnly}
          hint={idHint(published, readOnly)}
          onCommit={(id) => editDefinition((value) => ({ ...value, id }))}
        />
      </MoreRules>
    </>
  );
}

/** How this workflow shows one built-in issue type. Its ID is part of the fixed vocabulary. */
export function IssueTypeInspector({
  issueType,
}: {
  issueType: WorkflowIssueTypeDefinition;
}): ReactElement {
  const { edit, editText } = useElementEdit("issueType", issueType.id);
  const text = (field: "description" | "guidance", value: string | undefined) =>
    editText([field], (current) => withOptional(current, field, value));
  return (
    <InspectorSection>
      <TextField
        label="Name"
        path={["label"]}
        value={issueType.label}
        hint="Shows with the icon on task badges and in the new task form."
        onChange={(label) => editText(["label"], (current) => ({ ...current, label }))}
      />
      <SelectField
        label="Icon"
        path={["icon"]}
        value={issueType.icon}
        noneLabel="No icon"
        // The glyphs of task badges, so the picker shows the icon that a badge of this type shows.
        options={iconOptions(workflowIconSchema.options).map((option) => ({
          ...option,
          icon: (
            <IssueTypeIcon
              issueType={{ id: option.value, label: option.label, icon: option.value }}
            />
          ),
        }))}
        onChange={(icon) => edit((current) => withOptional(current, "icon", icon))}
      />
      <OptionalTextField
        label="Description"
        path={["description"]}
        multiline
        value={issueType.description}
        hint="Shows under the type in the new task form."
        onChange={(value) => text("description", value)}
      />
      <OptionalTextField
        label="Guidance"
        path={["guidance"]}
        value={issueType.guidance}
        multiline
        hint="Writing advice that the new task form shows after a person picks this type. Without it, the form shows the description."
        onChange={(value) => text("guidance", value)}
      />
    </InspectorSection>
  );
}
