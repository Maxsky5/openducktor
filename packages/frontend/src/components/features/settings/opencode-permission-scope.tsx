import type { OpenCodePermissionRule } from "@openducktor/contracts";
import { useId, useRef, useState, type ReactElement } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NEW_RULE } from "./opencode-permission-options";
import { PermissionRow } from "./opencode-permission-row";

type PermissionScopeProps = {
  label: string;
  rules: OpenCodePermissionRule[];
  disabled: boolean;
  isRole?: boolean;
  onChange: (rules: OpenCodePermissionRule[]) => void;
};

export function PermissionScope({
  label,
  rules,
  disabled,
  isRole = false,
  onChange,
}: PermissionScopeProps): ReactElement {
  const scopeId = useId();
  // Reset row keys when the parent replaces a draft; edits and moves keep the same rows.
  const [rows, setRows] = useState(() => ({
    rules,
    ids: rules.map((_, index) => index),
    nextId: rules.length,
  }));
  const scopeRef = useRef<HTMLDivElement>(null);
  const inheritanceText =
    rules.length > 0
      ? "These rules run after native rules."
      : "Inherits native OpenCode behavior, subject to workflow policy.";
  let ids = rows.ids;
  if (rows.rules !== rules) {
    ids = rules.map((_, index) => rows.nextId + index);
    setRows({ rules, ids, nextId: rows.nextId + rules.length });
  }
  const commit = (nextRules: OpenCodePermissionRule[], nextIds = ids) => {
    setRows({
      rules: nextRules,
      ids: nextIds,
      nextId: Math.max(rows.nextId, ...nextIds.map((id) => id + 1)),
    });
    onChange(nextRules);
  };
  const update = (index: number, rule: OpenCodePermissionRule) =>
    commit(rules.map((current, position) => (position === index ? rule : current)));
  const focusRule = (ruleId: number | undefined) => {
    requestAnimationFrame(() => {
      const selector =
        ruleId === undefined
          ? `[id="${scopeId}-add"]`
          : `[aria-labelledby="${scopeId}-${ruleId}-target-label"]`;
      scopeRef.current?.querySelector<HTMLElement>(selector)?.focus();
    });
  };
  const move = (index: number, delta: -1 | 1) => {
    const nextRules = [...rules];
    const nextIds = [...ids];
    [nextRules[index], nextRules[index + delta]] = [nextRules[index + delta]!, nextRules[index]!];
    [nextIds[index], nextIds[index + delta]] = [nextIds[index + delta]!, nextIds[index]!];
    commit(nextRules, nextIds);
    focusRule(ids[index]);
  };
  return (
    <div ref={scopeRef} className={cn("grid gap-3", !isRole && "border-t border-border pt-4")}>
      <div className={cn("flex items-start gap-4", isRole ? "justify-end" : "justify-between")}>
        {!isRole ? (
          <div className="grid gap-1">
            <h5 className="text-sm font-semibold text-foreground">{label}</h5>
            <p className="text-xs text-muted-foreground">{inheritanceText}</p>
          </div>
        ) : null}
        <Button
          id={`${scopeId}-add`}
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            commit([...rules, { ...NEW_RULE }], [...ids, rows.nextId]);
            focusRule(rows.nextId);
          }}
        >
          <Plus aria-hidden="true" />
          Add {label.toLowerCase()} rule
        </Button>
      </div>
      {rules.map((rule, index) => (
        <PermissionRow
          key={ids[index]}
          id={`${scopeId}-${ids[index]}`}
          label={`${label} rule ${index + 1}`}
          rule={rule}
          disabled={disabled}
          canMoveEarlier={index > 0}
          canMoveLater={index + 1 < rules.length}
          onChange={(next) => update(index, next)}
          onMove={(delta) => move(index, delta)}
          onRemove={() => {
            const focusId = ids[index + 1] ?? ids[index - 1];
            commit(
              rules.filter((_, position) => position !== index),
              ids.filter((_, position) => position !== index),
            );
            focusRule(focusId);
          }}
        />
      ))}
    </div>
  );
}
