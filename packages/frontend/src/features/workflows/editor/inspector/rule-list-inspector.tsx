import { ListOrdered } from "lucide-react";
import type { WorkflowActionRule, WorkflowLaunchOrderRule } from "@openducktor/contracts";
import type { ReactElement } from "react";
import type { RuleListKind } from "../model/document-elements";
import { updateDefinition, withOptional } from "../model/document-edits";
import { ConditionField } from "./condition-builder";
import { OptionalBooleanField } from "./choice-fields";
import { ItemList } from "./item-list";
import { IdListField } from "./reference-fields";
import { useInspector } from "./inspector-context";
import { InspectorSection } from "./inspector-section";

const DESCRIPTIONS = {
  actionOrder: "The first rule whose condition matches gives the base order of the actions.",
  actionPriority:
    "The first rule whose condition matches puts its actions ahead of the base order.",
  launchOrder:
    "The first rule whose condition and pull request presence match orders the launch candidates. Other candidates follow in declaration order.",
} satisfies Record<RuleListKind, string>;

const TITLES = {
  actionOrder: "Action order",
  actionPriority: "Action priority",
  launchOrder: "Launch order",
} satisfies Record<RuleListKind, string>;

export function RuleListInspector({ kind }: { kind: RuleListKind }): ReactElement {
  const { document, change, options } = useInspector();
  const definition = document.definition;
  const setActionRules = (rules: WorkflowActionRule[]) =>
    change((current) =>
      updateDefinition(current, (value) =>
        kind === "launchOrder" ? value : { ...value, [kind]: rules },
      ),
    );
  const setLaunchRules = (launchOrder: WorkflowLaunchOrderRule[]) =>
    change((current) => updateDefinition(current, (value) => ({ ...value, launchOrder })));

  return (
    <InspectorSection title={TITLES[kind]} Icon={ListOrdered} color="slate">
      {kind === "launchOrder" ? (
        <ItemList<WorkflowLaunchOrderRule>
          label={DESCRIPTIONS[kind]}
          path={[]}
          items={definition.launchOrder}
          ordered
          addLabel="Add rule"
          itemTitle={(_, index) => `Rule ${index + 1}`}
          create={() => ({ when: true, order: [] })}
          onChange={setLaunchRules}
          renderItem={(rule, index, update) => (
            <>
              <ConditionField
                label="When"
                path={[index, "when"]}
                value={rule.when}
                onChange={(when) => update({ ...rule, when })}
              />
              <OptionalBooleanField
                label="Pull request"
                path={[index, "pullRequest"]}
                value={rule.pullRequest}
                defaultLabel="With or without a pull request"
                onLabel="Only with a pull request"
                offLabel="Only without a pull request"
                onChange={(pullRequest) => update(withOptional(rule, "pullRequest", pullRequest))}
              />
              <IdListField
                label="Order"
                path={[index, "order"]}
                values={rule.order}
                options={options.launchActionsWithPullRequest}
                ordered
                addLabel="Add launch action"
                onChange={(order) => update({ ...rule, order })}
              />
            </>
          )}
        />
      ) : (
        <ItemList<WorkflowActionRule>
          label={DESCRIPTIONS[kind]}
          path={[]}
          items={definition[kind]}
          ordered
          addLabel="Add rule"
          itemTitle={(_, index) => `Rule ${index + 1}`}
          create={() => ({ when: true, actions: [] })}
          onChange={setActionRules}
          renderItem={(rule, index, update) => (
            <>
              <ConditionField
                label="When"
                path={[index, "when"]}
                value={rule.when}
                onChange={(when) => update({ ...rule, when })}
              />
              <IdListField
                label="Actions"
                path={[index, "actions"]}
                values={rule.actions}
                options={options.actions}
                ordered
                addLabel="Add action"
                onChange={(actions) => update({ ...rule, actions })}
              />
            </>
          )}
        />
      )}
    </InspectorSection>
  );
}
