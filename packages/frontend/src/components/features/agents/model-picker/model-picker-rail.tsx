import type {
  ModelPickerRuntime,
  ModelPickerSelectionPolicy,
  ModelPickerView,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import { Star } from "lucide-react";
import { type ReactElement, useId } from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const RuntimeRailButton = ({
  runtime,
  active,
  disabledReason,
  onSelect,
}: {
  runtime: ModelPickerRuntime;
  active: boolean;
  disabledReason: string | null;
  onSelect: () => void;
}): ReactElement => {
  const disabledReasonId = useId();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant={active ? "secondary" : "ghost"}
          className={cn(
            "size-9 shrink-0",
            active && "ring-1 ring-ring",
            disabledReason && "cursor-not-allowed opacity-50",
          )}
          aria-label={`${runtime.descriptor.label} runtime`}
          aria-pressed={active}
          aria-disabled={disabledReason !== null}
          aria-describedby={disabledReason ? disabledReasonId : undefined}
          onClick={disabledReason ? undefined : onSelect}
        >
          <AgentRuntimeIcon runtimeKind={runtime.descriptor.kind} />
        </Button>
      </TooltipTrigger>
      {disabledReason ? (
        <span id={disabledReasonId} className="sr-only">
          {disabledReason}
        </span>
      ) : null}
      <TooltipContent side="right">
        {disabledReason
          ? `${runtime.descriptor.label}: ${disabledReason}`
          : runtime.descriptor.label}
      </TooltipContent>
    </Tooltip>
  );
};

export function ModelPickerRail({
  runtimes,
  activeView,
  selectionPolicy,
  onSelectView,
}: {
  runtimes: readonly ModelPickerRuntime[];
  activeView: ModelPickerView;
  selectionPolicy: ModelPickerSelectionPolicy;
  onSelectView: (view: ModelPickerView) => void;
}): ReactElement {
  const favoritesDisabledReasonId = useId();
  const speedOnlyReason = selectionPolicy.kind === "speed_only" ? selectionPolicy.reason : null;
  return (
    <div className="flex min-h-0 flex-col items-center gap-1 overflow-y-auto border-r border-border bg-muted/40 p-2 ![scrollbar-gutter:auto]">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon"
            variant={activeView === "favorites" ? "secondary" : "ghost"}
            className={cn(
              "size-9 shrink-0",
              activeView === "favorites" && "ring-1 ring-ring",
              speedOnlyReason && "cursor-not-allowed opacity-50",
            )}
            aria-label="Favorite models"
            aria-pressed={activeView === "favorites"}
            aria-disabled={speedOnlyReason !== null}
            aria-describedby={speedOnlyReason ? favoritesDisabledReasonId : undefined}
            onClick={speedOnlyReason ? undefined : () => onSelectView("favorites")}
          >
            <Star aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        {speedOnlyReason ? (
          <span id={favoritesDisabledReasonId} className="sr-only">
            {speedOnlyReason}
          </span>
        ) : null}
        <TooltipContent side="right">
          {speedOnlyReason ? `Favorites: ${speedOnlyReason}` : "Favorites"}
        </TooltipContent>
      </Tooltip>
      {runtimes.map((runtime) => {
        const policyDisabledReason =
          selectionPolicy.kind === "speed_only"
            ? selectionPolicy.reason
            : selectionPolicy.kind === "runtime_locked" &&
                runtime.descriptor.kind !== selectionPolicy.runtimeKind
              ? selectionPolicy.reason
              : null;
        return (
          <RuntimeRailButton
            key={runtime.descriptor.kind}
            runtime={runtime}
            active={activeView === runtime.descriptor.kind}
            disabledReason={runtime.disabledReason ?? policyDisabledReason}
            onSelect={() => onSelectView(runtime.descriptor.kind)}
          />
        );
      })}
    </div>
  );
}
