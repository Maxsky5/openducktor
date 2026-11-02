import { autopilotRuleKey, jsonValuesEqual } from "@openducktor/contracts";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import * as schema from "./sqlite-host-settings-schema";
import {
  type HostSettingsWriter,
  settingsGroupChanged,
  settingsRowBatches,
  settingsWriteOperation as operation,
} from "./sqlite-host-settings-store-validation";

const keyOf = (rule: { workflowId: string; eventId: string }) =>
  autopilotRuleKey(rule.workflowId, rule.eventId);

/** Writes only the Autopilot rules that changed, and keeps the rows of the other rules. */
export const writeAutopilotRules: HostSettingsWriter = (session, current, next) =>
  Effect.gen(function* () {
    const previousRules = current?.autopilot.rules ?? [];
    if (jsonValuesEqual(current?.autopilot.rules, next.autopilot.rules))
      return settingsGroupChanged(false);
    const nextKeys = new Set(next.autopilot.rules.map(keyOf));
    const previousByKey = new Map(previousRules.map((rule) => [keyOf(rule), rule]));
    for (const rule of previousRules) {
      if (nextKeys.has(keyOf(rule))) continue;
      yield* session.execute(
        (db) =>
          db
            .delete(schema.autopilotRules)
            .where(
              and(
                eq(schema.autopilotRules.workflowId, rule.workflowId),
                eq(schema.autopilotRules.eventId, rule.eventId),
              ),
            ),
        operation,
      );
    }
    for (const rule of next.autopilot.rules) {
      const previous = previousByKey.get(keyOf(rule));
      if (jsonValuesEqual(previous, rule)) continue;
      if (!previous)
        yield* session.execute(
          (db) =>
            db
              .insert(schema.autopilotRules)
              .values({ workflowId: rule.workflowId, eventId: rule.eventId }),
          operation,
        );
      else if (previous.actionIds.length)
        yield* session.execute(
          (db) =>
            db
              .delete(schema.autopilotRuleActions)
              .where(
                and(
                  eq(schema.autopilotRuleActions.workflowId, rule.workflowId),
                  eq(schema.autopilotRuleActions.eventId, rule.eventId),
                ),
              ),
          operation,
        );
      const actions = rule.actionIds.map((actionId, position) => ({
        workflowId: rule.workflowId,
        eventId: rule.eventId,
        position,
        actionId,
      }));
      for (const rows of settingsRowBatches(actions))
        yield* session.execute(
          (db) => db.insert(schema.autopilotRuleActions).values(rows),
          operation,
        );
    }
    return settingsGroupChanged(true);
  });
