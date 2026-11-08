import {
  CircleAlert,
  MousePointerClick,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCog,
  Wrench,
} from "lucide-react";
import { chainDiagram } from "../chain";

/**
 * How OpenDucktor picks the model of a new workflow session: your choice in the start dialog,
 * then the role default, then the Default model. With none of them, the session cannot start.
 */
export const modelChoice = chainDiagram({
  name: "model-choice",
  label:
    "OpenDucktor uses the first model that is set: your choice in the start dialog, then the role default, then the Default model. If none is set, select a model, or Autopilot cannot start the role.",
  steps: [
    { id: "choice", title: "Your choice", text: "In the start dialog", Icon: MousePointerClick },
    { id: "role", title: "Role default", text: "Agent defaults by role", Icon: UserCog },
    {
      id: "default",
      title: "Default model",
      text: "Every role and workspace sessions",
      Icon: Sparkles,
    },
    {
      id: "none",
      title: "No model",
      text: "Select one to start",
      Icon: CircleAlert,
      tone: "system",
    },
  ],
  heights: { wide: 84, narrow: 72 },
  edge: { label: "If empty", still: true },
});

/**
 * The order in which the permission settings of a session apply: the native settings of the
 * harness, the OpenDucktor defaults, the role overrides, and last the workflow role limits.
 */
export const permissionOrder = chainDiagram({
  name: "permission-order",
  label:
    "The permission settings apply in this order: the native settings of your OpenCode or Claude Code setup, then the defaults for every role, then the role overrides for one role, then the workflow role limits. The workflow role limits apply last and reject write requests from Spec, Planner, and QA.",
  steps: [
    {
      id: "native",
      title: "Native settings",
      text: "Your OpenCode or Claude Code setup",
      Icon: Wrench,
    },
    { id: "defaults", title: "Defaults", text: "Every role", Icon: SlidersHorizontal },
    { id: "overrides", title: "Role overrides", text: "One role", Icon: UserCog },
    {
      id: "limits",
      title: "Workflow role limits",
      text: "Apply last. Reject write requests from Spec, Planner, and QA.",
      Icon: ShieldCheck,
      tone: "system",
    },
  ],
  heights: { wide: 104, narrow: 76 },
  edge: { still: true },
});
