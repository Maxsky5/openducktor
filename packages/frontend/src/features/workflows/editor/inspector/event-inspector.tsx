import {
  type WorkflowEventDefinition,
  type WorkflowEventGuard,
  type WorkflowEventOutcome,
} from "@openducktor/contracts";
import { idFromLabel } from "@openducktor/workflows";
import {
  Bot,
  Columns3,
  CornerDownRight,
  FileCheck2,
  FileX2,
  Plus,
  RotateCcw,
  ShieldCheck,
  Spline,
  Zap,
} from "lucide-react";
import { type ReactElement, useId, useRef } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { elementIds, eventNames } from "../model/document-elements";
import { withOptional } from "../model/document-edits";
import { LINK_BUTTON_CLASS } from "../panels/new-element-button";
import { ConditionField } from "./condition-builder";
import { EventSendersField } from "./event-senders-field";
import { useInspector } from "./inspector-context";
import { InspectorSection } from "./inspector-section";
import { PanelCard } from "./panel-card";
import { ToggleChips, useStateDots } from "./toggle-chips";
import { ItemList } from "./item-list";
import { hasProblemUnder, MoreRules } from "./more-rules";
import { SelectField } from "./reference-fields";
import { IdField, OptionalTextField } from "./text-fields";
import { useElementEdit } from "./use-element-edit";
import { FIELD_LABEL_CLASS } from "./field-shell";

type Outcome = WorkflowEventOutcome;

const GUARD_ROOTS = ["guards"] as const;
const ADVANCED_ROOTS = ["id", "outcomes"] as const;
const ID_ROOTS = ["id"] as const;

/** The last outcome that always matches is the fallback of the branches. */
const isFallback = (outcomes: readonly Outcome[], index: number): boolean =>
  index === outcomes.length - 1 && outcomes[index]!.when === true;

/** Where a transition starts and where it sends the task. */
function RouteSection({ event }: { event: WorkflowEventDefinition }): ReactElement {
  const { options } = useInspector();
  const stateDot = useStateDots();
  const { edit } = useElementEdit("event", event.id);
  const single = event.outcomes.length === 1 ? event.outcomes[0] : undefined;
  return (
    <InspectorSection title="Route" Icon={Spline} color="sky">
      <div className="flex flex-col gap-2">
        <span className={FIELD_LABEL_CLASS}>From</span>
        <ToggleChips
          label="From"
          path={["from"]}
          values={event.from}
          options={options.states}
          Icon={Columns3}
          color="violet"
          size="sm"
          leading={stateDot}
          min={1}
          onChange={(from) => edit((current) => ({ ...current, from }))}
        />
      </div>
      {single ? (
        <div className="flex flex-col gap-2">
          <SelectField
            label="To"
            path={["outcomes", 0, "to"]}
            value={single.to ?? undefined}
            noneLabel="Same state"
            options={options.states}
            onChange={(to) =>
              edit((current) => ({
                ...current,
                outcomes: current.outcomes.map((outcome, index) =>
                  index === 0 ? { ...outcome, to: to ?? null } : outcome,
                ),
              }))
            }
          />
          <AddBranchButton event={event} label="Branch on a condition" />
        </div>
      ) : (
        <Branches event={event} />
      )}
    </InspectorSection>
  );
}

/** The checks that must pass before the task moves. */
function Requirements({ event }: { event: WorkflowEventDefinition }): ReactElement {
  const { edit, editText } = useElementEdit("event", event.id);
  const guardIds = new Set(event.guards.map(({ id }) => id));
  return (
    <ItemList<WorkflowEventGuard>
      hint="The task moves only when all of them pass."
      path={["guards"]}
      items={event.guards}
      addLabel="Add a requirement"
      itemTitle={(_, index) => `Requirement ${index + 1}`}
      create={() => ({ id: idFromLabel("check", guardIds), when: true })}
      onChange={(guards) => edit((current) => ({ ...current, guards }))}
      renderItem={(guard, index, update) => (
        <>
          <ConditionField
            label="Passes when"
            path={["guards", index, "when"]}
            value={guard.when}
            onChange={(when) => update({ ...guard, when })}
          />
          <OptionalTextField
            label="Message when it fails"
            path={["guards", index, "message"]}
            value={guard.message}
            placeholder="Such as: Add a spec first."
            onChange={(message) =>
              editText(["guards", index, "message"], (current) => ({
                ...current,
                guards: current.guards.map((item, other) =>
                  other === index ? withOptional(item, "message", message) : item,
                ),
              }))
            }
          />
          <IdField
            path={["guards", index, "id"]}
            value={guard.id}
            taken={guardIds}
            onCommit={(id) => update({ ...guard, id })}
          />
        </>
      )}
    />
  );
}

/** The Autopilot signal and the role that caused the move, of one outcome. */
function OutcomeExtras({
  outcome,
  index,
  update,
}: {
  outcome: Outcome;
  index: number;
  update: (outcome: Outcome) => void;
}): ReactElement {
  const { options } = useInspector();
  return (
    <>
      <SelectField
        label="Autopilot signal"
        path={["outcomes", index, "signal"]}
        value={outcome.signal}
        noneLabel="No signal"
        options={options.signals}
        onChange={(signal) => update(withOptional(outcome, "signal", signal))}
      />
      <SelectField
        label="Notification opens"
        path={["outcomes", index, "sourceRole"]}
        value={outcome.sourceRole}
        noneLabel="Nothing"
        hint="A click on the notification of the new state opens the latest session of this role."
        options={options.boundRoles}
        onChange={(sourceRole) => update(withOptional(outcome, "sourceRole", sourceRole))}
      />
    </>
  );
}

/** Adds a branch before the fallback. It matches nothing until the user sets its condition. */
function AddBranchButton({
  event,
  label,
}: {
  event: WorkflowEventDefinition;
  label: string;
}): ReactElement | null {
  const { readOnly } = useInspector();
  const { edit } = useElementEdit("event", event.id);
  if (readOnly) return null;
  return (
    <button
      type="button"
      className={LINK_BUTTON_CLASS}
      onClick={() =>
        edit((current) => ({
          ...current,
          outcomes: [
            ...current.outcomes.slice(0, -1),
            { when: false, to: null },
            current.outcomes.at(-1)!,
          ],
        }))
      }
    >
      <Plus aria-hidden="true" className="size-3.5" />
      {label}
    </button>
  );
}

/**
 * The branches: each sends the task to its own state when its condition matches. The first match
 * wins, and the last branch without a condition is the fallback. It keeps its place.
 */
function Branches({ event }: { event: WorkflowEventDefinition }): ReactElement {
  const { options } = useInspector();
  const { edit } = useElementEdit("event", event.id);
  const outcomes = event.outcomes;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className={FIELD_LABEL_CLASS}>To</span>
        <p className="text-xs leading-5 text-muted-foreground">The first match wins.</p>
      </div>
      <ItemList<Outcome>
        path={["outcomes"]}
        items={outcomes}
        min={1}
        ordered
        pinned={(index) => isFallback(outcomes, index)}
        itemLeading={(_, index) => (
          <BranchBadge fallback={isFallback(outcomes, index)} index={index} />
        )}
        itemTitle={(_, index) =>
          isFallback(outcomes, index) ? "Otherwise" : `Branch ${index + 1}`
        }
        onChange={(next) => edit((current) => ({ ...current, outcomes: next }))}
        renderItem={(outcome, index, update) => (
          <>
            {isFallback(outcomes, index) ? null : (
              <ConditionField
                label="If"
                path={["outcomes", index, "when"]}
                value={outcome.when}
                onChange={(when) => update({ ...outcome, when })}
              />
            )}
            <SelectField
              label="Go to"
              path={["outcomes", index, "to"]}
              value={outcome.to ?? undefined}
              noneLabel="Same state"
              options={options.states}
              onChange={(to) => update({ ...outcome, to: to ?? null })}
            />
            <OutcomeExtras outcome={outcome} index={index} update={update} />
          </>
        )}
      />
      <AddBranchButton event={event} label="Add a branch" />
    </div>
  );
}

/** The number of a branch, or a mark for the fallback. */
function BranchBadge({ fallback, index }: { fallback: boolean; index: number }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-500/12 text-[11px] font-semibold text-sky-700 tabular-nums dark:bg-sky-400/15 dark:text-sky-300"
    >
      {fallback ? <CornerDownRight className="size-3" /> : index + 1}
    </span>
  );
}

/** What the reset deletes and what it keeps. The review documents go, the other documents stay. */
const resetSteps = (reviewNames: readonly string[], documentNames: readonly string[]) => [
  {
    Icon: RotateCcw,
    tone: "text-destructive-muted",
    text: "The code goes back to where the task started. Code changes are lost.",
  },
  {
    Icon: FileX2,
    tone: "text-destructive-muted",
    text:
      reviewNames.length > 0
        ? `Reviews are deleted: ${reviewNames.join(", ")}. The pull request link is deleted too.`
        : "The pull request link is deleted.",
  },
  ...(documentNames.length > 0
    ? [
        {
          Icon: FileCheck2,
          tone: "text-emerald-600 dark:text-emerald-400",
          text: `Documents stay: ${documentNames.join(", ")}.`,
        },
      ]
    : []),
];

/**
 * The `worktree.reset` effect, as a card with its own switch: before the move, the host restores
 * the task worktree, deletes the review reports and the pull request link, and clears the session
 * history of the roles that the user picks. The other roles keep their sessions.
 */
function WorktreeResetCard({ event }: { event: WorkflowEventDefinition }): ReactElement {
  const { document, options, readOnly } = useInspector();
  const { edit } = useElementEdit("event", event.id);
  const switchId = useId();
  const reset = event.effects?.find(({ id }) => id === "worktree.reset");
  // The roles of a reset that the user turned off come back when it turns on again.
  const lastRoles = useRef<string[]>([]);
  const artifactNames = (kind: "review" | "document") =>
    document.definition.artifacts
      .filter((artifact) => artifact.kind === kind)
      .map(({ id, label }) => label || id);
  const setRoles = (clearsSessionsOf: string[]) =>
    edit((current) => ({
      ...current,
      effects: (current.effects ?? []).map((effect) =>
        effect.id === "worktree.reset" ? { ...effect, clearsSessionsOf } : effect,
      ),
    }));
  return (
    <PanelCard
      title="Reset the work"
      // On, the card lists each part of the reset.
      description={reset ? undefined : "Discards the code changes before the move."}
      Icon={RotateCcw}
      color="rose"
      actions={
        <Switch
          id={switchId}
          aria-label="Reset the work"
          className="mt-1"
          checked={reset !== undefined}
          disabled={readOnly}
          onCheckedChange={(on) => {
            if (!on && reset) lastRoles.current = reset.clearsSessionsOf;
            edit((current) =>
              withOptional(
                current,
                "effects",
                on ? [{ id: "worktree.reset", clearsSessionsOf: lastRoles.current }] : undefined,
              ),
            );
          }}
        />
      }
    >
      {reset ? (
        <>
          <section className="flex flex-col gap-2">
            <h4 className={FIELD_LABEL_CLASS}>Always happens</h4>
            <ul className="flex flex-col gap-1.5">
              {resetSteps(artifactNames("review"), artifactNames("document")).map(
                ({ Icon, tone, text }) => (
                  <li key={text} className="flex items-start gap-2.5 text-xs leading-5">
                    <Icon aria-hidden="true" className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
                    <span>{text}</span>
                  </li>
                ),
              )}
            </ul>
          </section>
          <section className="flex flex-col gap-2 border-t border-border/70 pt-3">
            <div className="flex flex-col gap-0.5">
              <h4 className={FIELD_LABEL_CLASS}>You pick: clear the sessions of</h4>
              <p className="text-xs leading-5 text-muted-foreground">
                Their next start opens a new session.
              </p>
            </div>
            {options.boundRoles.length > 0 ? (
              <ToggleChips
                label="Clear the sessions of"
                Icon={Bot}
                color="rose"
                path={["effects", 0, "clearsSessionsOf"]}
                values={reset.clearsSessionsOf}
                options={options.boundRoles}
                onChange={setRoles}
              />
            ) : (
              <p className="text-xs leading-5 text-muted-foreground">
                This workflow has no role yet. Add roles under Roles in the element list.
              </p>
            )}
            {reset.clearsSessionsOf.length === 0 ? (
              <p className="text-xs leading-5 text-muted-foreground">
                No role is picked. Every session continues.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </PanelCard>
  );
}

/** A transition: its route, what triggers it, its requirements, its reset, and the rest. */
export function EventInspector({ event }: { event: WorkflowEventDefinition }): ReactElement {
  const { document, rename, problemPaths, catalogRoles } = useInspector();
  const { edit, editText } = useElementEdit("event", event.id);
  const single = event.outcomes.length === 1 ? event.outcomes[0] : undefined;
  // A branch shows its signal and role in its card. A transition without branches shows them here.
  const advancedActive =
    single?.signal !== undefined ||
    single?.sourceRole !== undefined ||
    hasProblemUnder(problemPaths, ["id"]);

  return (
    <>
      <InspectorSection>
        <OptionalTextField
          label="Name"
          path={["label"]}
          value={event.label}
          placeholder={
            eventNames(
              document.definition,
              new Map(catalogRoles.map(({ role }) => [role.id, role.label])),
            ).get(event.id) ?? ""
          }
          onChange={(label) =>
            editText(["label"], (current) => withOptional(current, "label", label))
          }
        />
      </InspectorSection>
      <RouteSection event={event} />
      <InspectorSection title="Triggers" Icon={Zap} color="amber">
        <EventSendersField event={event} />
      </InspectorSection>
      <WorktreeResetCard event={event} />
      <MoreRules
        title="Requirements"
        Icon={ShieldCheck}
        color="indigo"
        active={event.guards.length > 0 || hasProblemUnder(problemPaths, GUARD_ROOTS)}
        roots={GUARD_ROOTS}
      >
        <Requirements event={event} />
      </MoreRules>
      <MoreRules
        title="Advanced"
        active={advancedActive}
        roots={single ? ADVANCED_ROOTS : ID_ROOTS}
      >
        {single ? (
          <OutcomeExtras
            outcome={single}
            index={0}
            update={(outcome) => edit((current) => ({ ...current, outcomes: [outcome] }))}
          />
        ) : null}
        <IdField
          path={["id"]}
          value={event.id}
          taken={elementIds(document, "event")}
          onCommit={(next) => rename("event", event.id, next)}
        />
      </MoreRules>
    </>
  );
}
