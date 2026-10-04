import type { AgentRole, OpenCodePermissionRule } from "@openducktor/contracts";
import { useId, useRef, type ReactElement } from "react";
import { Combobox } from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import { AGENT_ROLE_LABELS } from "@/types/agent-role-labels";
import { NEW_RULE, ROLE_OPTIONS } from "./opencode-permission-options";
import { PermissionScope } from "./opencode-permission-scope";

type PermissionRoleProps = {
  role: AgentRole;
  rules: OpenCodePermissionRule[];
  disabled: boolean;
  onChange: (rules: OpenCodePermissionRule[]) => void;
};

export function PermissionRole({
  role,
  rules,
  disabled,
  onChange,
}: PermissionRoleProps): ReactElement {
  const id = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const label = AGENT_ROLE_LABELS[role];
  const hasRules = rules.length > 0;
  const ruleLabel = rules.length === 1 ? "rule" : "rules";
  const summary = hasRules ? `${rules.length} ${ruleLabel} after defaults` : "Inherits defaults";
  return (
    <div
      ref={rowRef}
      className="grid gap-2 px-3 py-2.5 @min-[28rem]:grid-cols-[minmax(7rem,9rem)_minmax(0,1fr)] @min-[28rem]:items-center"
    >
      <div className="flex flex-col gap-1">
        <Label id={`${id}-label`} className="text-sm font-medium text-foreground">
          {label}
          <span className="sr-only"> permission rules</span>
        </Label>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </div>
      <Combobox
        value={hasRules ? "custom" : "inherit"}
        options={ROLE_OPTIONS}
        disabled={disabled}
        triggerAriaLabelledBy={`${id}-label`}
        onValueChange={(value) => {
          if (value === "inherit") onChange([]);
          else if (!hasRules) onChange([{ ...NEW_RULE }]);
        }}
      />
      {hasRules ? (
        <div className="min-w-0 @min-[28rem]:col-span-2">
          <PermissionScope
            label={label}
            rules={rules}
            disabled={disabled}
            isRole
            onChange={(next) => {
              onChange(next);
              if (next.length === 0) {
                requestAnimationFrame(() => {
                  rowRef.current
                    ?.querySelector<HTMLElement>(`[aria-labelledby="${id}-label"]`)
                    ?.focus();
                });
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
