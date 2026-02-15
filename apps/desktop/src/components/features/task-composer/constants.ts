import type { IssueTypeOption, PriorityOption } from "@/types/task-composer";
import { Bug, Layers3, Lightbulb, ListTodo, Sparkles, Wrench } from "lucide-react";

export const ISSUE_TYPE_OPTIONS: IssueTypeOption[] = [
  {
    value: "feature",
    label: "Feature",
    description: "User-facing capability or workflow improvement.",
    icon: Sparkles,
    accentClass: "border-sky-300 bg-sky-50/90",
    iconClass: "bg-sky-100 text-sky-700",
    supportsParent: true,
  },
  {
    value: "bug",
    label: "Bug",
    description: "Unexpected behavior, regression, or production defect.",
    icon: Bug,
    accentClass: "border-rose-300 bg-rose-50/90",
    iconClass: "bg-rose-100 text-rose-700",
    supportsParent: true,
  },
  {
    value: "task",
    label: "Task",
    description: "Standard implementation work item.",
    icon: ListTodo,
    accentClass: "border-slate-300 bg-slate-100/80",
    iconClass: "bg-slate-200 text-slate-700",
    supportsParent: true,
  },
  {
    value: "chore",
    label: "Chore",
    description: "Maintenance, upgrades, tooling, or non-user-visible work.",
    icon: Wrench,
    accentClass: "border-amber-300 bg-amber-50/90",
    iconClass: "bg-amber-100 text-amber-700",
    supportsParent: true,
  },
  {
    value: "epic",
    label: "Epic",
    description: "Large initiative that contains multiple subtasks.",
    icon: Layers3,
    accentClass: "border-violet-300 bg-violet-50/90",
    iconClass: "bg-violet-100 text-violet-700",
    supportsParent: false,
  },
  {
    value: "decision",
    label: "Decision",
    description: "Architecture/product decision record with explicit rationale.",
    icon: Lightbulb,
    accentClass: "border-emerald-300 bg-emerald-50/90",
    iconClass: "bg-emerald-100 text-emerald-700",
    supportsParent: false,
  },
];

export const PRIORITY_OPTIONS: PriorityOption[] = [
  { value: 0, label: "P0", hint: "Critical" },
  { value: 1, label: "P1", hint: "High" },
  { value: 2, label: "P2", hint: "Normal" },
  { value: 3, label: "P3", hint: "Low" },
  { value: 4, label: "P4", hint: "Very low" },
];
