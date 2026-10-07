import { agentRoleValues } from "@openducktor/contracts";
import type { AgentRole } from "@openducktor/core";
import { createLucideIcon, type LucideIcon } from "lucide-react";
import { AGENT_ROLE_LABELS } from "@/types/agent-role-labels";

// Custom drawings on the lucide 24px grid, so role icons keep the same stroke and sizing as other app icons.
export const SpecRoleIcon = createLucideIcon("role-spec", [
  ["path", { d: "M10 21H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h6l5 5v2", key: "page" }],
  ["path", { d: "M8 7h3", key: "line-1" }],
  ["path", { d: "M8 11h2", key: "line-2" }],
  ["circle", { cx: "17", cy: "17", r: "4", key: "target" }],
  [
    "circle",
    { cx: "17", cy: "17", r: "1.25", fill: "currentColor", stroke: "none", key: "target-center" },
  ],
]);

export const PlannerRoleIcon = createLucideIcon("role-planner", [
  ["path", { d: "M21 8c0 3.5-5 8-5 8s-5-4.5-5-8a5 5 0 0 1 10 0", key: "pin" }],
  [
    "circle",
    { cx: "16", cy: "8", r: "1.5", fill: "currentColor", stroke: "none", key: "pin-center" },
  ],
  ["circle", { cx: "5.5", cy: "18.5", r: "2.5", key: "start" }],
  ["path", { d: "M8 18.5h5a3 3 0 0 0 2.6-1.5", key: "route" }],
]);

export const BuilderRoleIcon = createLucideIcon("role-builder", [
  ["path", { d: "M4 14.5a8 8.5 0 0 1 16 0", key: "dome" }],
  ["path", { d: "M10 6.3V11", key: "ridge-left" }],
  ["path", { d: "M14 6.3V11", key: "ridge-right" }],
  ["rect", { x: "2", y: "14.5", width: "20", height: "5", rx: "2.5", key: "brim" }],
]);

export const QaRoleIcon = createLucideIcon("role-qa", [
  ["circle", { cx: "10.5", cy: "10.5", r: "7.5", key: "lens" }],
  ["path", { d: "m21 21-5.2-5.2", key: "handle" }],
  ["path", { d: "m7.5 10.5 2 2 4-4", key: "check" }],
]);

export const AGENT_ROLE_ICONS = {
  spec: SpecRoleIcon,
  planner: PlannerRoleIcon,
  build: BuilderRoleIcon,
  qa: QaRoleIcon,
} satisfies Record<AgentRole, LucideIcon>;

export const ROLE_OPTIONS = agentRoleValues.map((role) => ({
  role,
  label: AGENT_ROLE_LABELS[role],
  icon: AGENT_ROLE_ICONS[role],
}));
