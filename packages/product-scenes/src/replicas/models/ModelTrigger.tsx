// The trigger of the model picker, from model-picker-trigger.tsx: the runtime mark, the OpenCode
// agent profile, the model, the effort badge, and the speed above Standard. The composer variant is
// a quiet ghost button that shows only the Zap of the speed, and the form variant is an outline
// field that names the speed. The trigger holds the four runtime marks and every part, and
// `modelTrigger` of model-trigger.ts shows another selection without new markup.
import { ChevronsUpDown } from "lucide-react";
import type { ComponentProps, ReactElement } from "react";
import { type ModelChoice, modelName, RUNTIMES } from "../../sample/models";
import { classes } from "../classes";
import { flag } from "../flag";
import { RuntimeIcon } from "../ui/RuntimeIcon";
import { Zap } from "../ui/Zap";
import "./ModelTrigger.css";

type ModelTriggerProps = Omit<ComponentProps<"span">, "children"> & {
  value: ModelChoice;
  variant: "composer" | "form";
  /** A read-only picker: cursor-not-allowed opacity-50. */
  disabled?: boolean;
};

export function ModelTrigger({
  value,
  variant,
  disabled = false,
  className,
  ...attributes
}: ModelTriggerProps): ReactElement {
  return (
    <span
      className={classes("mt", className)}
      data-variant={variant}
      data-disabled={flag(disabled)}
      data-model-trigger=""
      {...attributes}
    >
      <span className="mt-summary">
        <span className="mt-logos" data-runtime={value.runtime} data-runtime-logos="">
          {RUNTIMES.map((kind) => (
            <RuntimeIcon kind={kind} key={kind} />
          ))}
        </span>
        <span className="mt-profile" hidden={!value.profile} data-profile="">
          {value.profile}
        </span>
        <span className="mt-slash" hidden={!value.profile} aria-hidden="true" data-profile-slash="">
          /
        </span>
        <span className="mt-model" data-model-name="">
          {modelName(value)}
        </span>
        <span className="mt-effort" hidden={!value.effort} data-effort="">
          {value.effort}
        </span>
        <span className="mt-speed" hidden={value.speed !== "fast"} data-speed="">
          <Zap className="i14" />
          {variant === "form" && <span>Fast</span>}
        </span>
      </span>
      <ChevronsUpDown className="mt-chevron" />
    </span>
  );
}
