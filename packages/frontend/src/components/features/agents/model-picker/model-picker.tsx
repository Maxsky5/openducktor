import type { AgentModelFavorite, RuntimeKind } from "@openducktor/contracts";
import { Check, ChevronsUpDown, LoaderCircle, Star } from "lucide-react";
import {
  type ReactElement,
  type KeyboardEvent as ReactKeyboardEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AgentRuntimeIcon } from "@/components/features/agents/agent-runtime-icon";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  buildModelPickerItems,
  isSameModelPickerValue,
  type ModelPickerItem,
  type ModelPickerRuntime,
  type ModelPickerValue,
  type ModelPickerView,
  modelPickerValueKey,
} from "./model-picker-model";

export type ModelPickerFavoriteState = {
  favorites: AgentModelFavorite[] | null;
  isLoading: boolean;
  readError: string | null;
  isMutationPending: boolean;
  mutationError: string | null;
  canMutate: boolean;
  toggleFavorite: (favorite: AgentModelFavorite) => void;
  retryRead: () => void;
  retryMutation: () => void;
};

export type ModelPickerSelectionPolicy =
  | { kind: "editable" }
  | { kind: "runtime_locked"; runtimeKind: RuntimeKind; reason: string }
  | { kind: "read_only"; reason: string };

type ModelPickerProps = {
  runtimes: readonly ModelPickerRuntime[];
  value: ModelPickerValue | null;
  favoriteState: ModelPickerFavoriteState;
  selectionPolicy: ModelPickerSelectionPolicy;
  onValueChange: (value: ModelPickerValue) => void;
  getModelDisabledReason?: (item: ModelPickerItem) => string | null;
  triggerClassName?: string;
  placeholder?: string;
  onOpenChange?: (open: boolean) => void;
};

const activeViewFor = (
  value: ModelPickerValue | null,
  runtimes: readonly ModelPickerRuntime[],
  selectionPolicy: ModelPickerSelectionPolicy,
): ModelPickerView => {
  if (selectionPolicy.kind === "runtime_locked") {
    return selectionPolicy.runtimeKind;
  }
  return value?.runtimeKind ?? runtimes[0]?.descriptor.kind ?? "favorites";
};

const ResourceNotice = ({ runtime }: { runtime: ModelPickerRuntime }): ReactElement | null => {
  if (runtime.resource.isLoading) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle className="animate-spin" aria-hidden="true" />
        Loading {runtime.descriptor.label} models...
      </div>
    );
  }
  if (!runtime.resource.error) {
    return null;
  }
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm" role="alert">
      <span className="min-w-0 text-destructive">
        {runtime.descriptor.label}: {runtime.resource.error}
      </span>
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => void runtime.resource.retry()}
      >
        Retry
      </Button>
    </div>
  );
};

const FavoriteNotice = ({ state }: { state: ModelPickerFavoriteState }): ReactElement | null => {
  if (state.readError) {
    return (
      <div
        className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm"
        role="alert"
      >
        <span className="min-w-0 text-destructive">Favorites unavailable: {state.readError}</span>
        <Button type="button" variant="outline" size="xs" onClick={state.retryRead}>
          Retry
        </Button>
      </div>
    );
  }
  if (!state.mutationError) {
    return null;
  }
  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm"
      role="alert"
    >
      <span className="min-w-0 text-destructive">{state.mutationError}</span>
      <Button type="button" variant="outline" size="xs" onClick={state.retryMutation}>
        Retry
      </Button>
    </div>
  );
};

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
            "size-9",
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

const stopFavoriteActivationPropagation = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
  if (event.key === "Enter" || event.key === " ") {
    event.stopPropagation();
  }
};

const ModelRow = ({
  item,
  selected,
  favoriteState,
  disabledReason,
  onSelect,
}: {
  item: ModelPickerItem;
  selected: boolean;
  favoriteState: ModelPickerFavoriteState;
  disabledReason: string | null;
  onSelect: () => void;
}): ReactElement => {
  const favoriteLabel = item.isFavorite ? "Remove" : "Add";
  return (
    <CommandItem
      value={modelPickerValueKey(item.value)}
      disabled={disabledReason !== null}
      aria-selected={selected}
      aria-description={disabledReason ?? undefined}
      className={cn("min-h-12 px-3 py-2", selected && "bg-accent")}
      onSelect={onSelect}
    >
      <AgentRuntimeIcon runtimeKind={item.runtime.kind} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{item.model.modelName}</span>
        <span className="truncate text-xs text-muted-foreground">
          {item.runtime.label} · {item.model.providerName} · {item.model.modelId}
        </span>
      </span>
      {selected ? <Check aria-label="Selected model" /> : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        disabled={!favoriteState.canMutate}
        aria-label={`${favoriteLabel} ${item.model.modelName} ${item.isFavorite ? "from" : "to"} favorites`}
        aria-pressed={item.isFavorite}
        onPointerDown={(event) => event.stopPropagation()}
        onKeyDown={stopFavoriteActivationPropagation}
        onKeyUp={stopFavoriteActivationPropagation}
        onClick={(event) => {
          event.stopPropagation();
          favoriteState.toggleFavorite(item.value);
        }}
      >
        <Star
          aria-hidden="true"
          className={cn(item.isFavorite && "fill-current text-warning-muted")}
        />
      </Button>
    </CommandItem>
  );
};

export function ModelPicker({
  runtimes,
  value,
  favoriteState,
  selectionPolicy,
  onValueChange,
  getModelDisabledReason,
  triggerClassName,
  placeholder = "Select a model",
  onOpenChange,
}: ModelPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState<ModelPickerView>(() =>
    activeViewFor(value, runtimes, selectionPolicy),
  );
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lockedRuntimeKind =
    selectionPolicy.kind === "runtime_locked" ? selectionPolicy.runtimeKind : null;
  const items = useMemo(
    () =>
      buildModelPickerItems({
        runtimes,
        favorites: favoriteState.favorites,
        activeView,
        searchQuery,
        lockedRuntimeKind,
      }),
    [activeView, favoriteState.favorites, lockedRuntimeKind, runtimes, searchQuery],
  );
  const selectedRuntime = runtimes.find(
    (runtime) => runtime.descriptor.kind === value?.runtimeKind,
  );
  const selectedItem = runtimes
    .flatMap((runtime) =>
      (runtime.resource.catalog?.models ?? []).map((model) => ({ runtime, model })),
    )
    .find(
      ({ runtime, model }) =>
        runtime.descriptor.kind === value?.runtimeKind &&
        model.providerId === value?.providerId &&
        model.modelId === value?.modelId,
    );
  const triggerRuntime = selectedRuntime?.descriptor ?? null;
  const triggerModelLabel = selectedItem?.model.modelName ?? value?.modelId ?? placeholder;
  const triggerAriaLabel = triggerRuntime
    ? `Select model, ${triggerRuntime.label}, ${triggerModelLabel}`
    : `Select model, ${triggerModelLabel}`;
  const visibleResources = runtimes.filter((runtime) => {
    if (lockedRuntimeKind && runtime.descriptor.kind !== lockedRuntimeKind) {
      return false;
    }
    if (searchQuery.trim() || activeView === "favorites") {
      return true;
    }
    return runtime.descriptor.kind === activeView;
  });
  const activeRuntime = runtimes.find((runtime) => runtime.descriptor.kind === activeView) ?? null;
  const readOnlyReason = selectionPolicy.kind === "read_only" ? selectionPolicy.reason : null;

  const handleOpenChange = (nextOpen: boolean): void => {
    if (readOnlyReason) {
      return;
    }
    if (nextOpen) {
      setActiveView(activeViewFor(value, runtimes, selectionPolicy));
      const activeElement = document.activeElement;
      setPortalContainer(
        activeElement instanceof HTMLElement
          ? activeElement.closest<HTMLElement>("[data-slot='dialog-content']")
          : null,
      );
    }
    setOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const emptyMessage = (() => {
    if (runtimes.length === 0) {
      return "No agent runtimes are available.";
    }
    if (searchQuery.trim()) {
      return "No models match your search.";
    }
    if (activeView === "favorites") {
      if (favoriteState.isLoading) {
        return "Loading favorites...";
      }
      if (favoriteState.readError) {
        return "Favorites are unavailable until settings load succeeds.";
      }
      return "No favorite models are available here. Use a model row's star to add one.";
    }
    if (activeRuntime?.resource.isLoading || activeRuntime?.resource.error) {
      return null;
    }
    return `No ${activeRuntime?.descriptor.label ?? "runtime"} models are available.`;
  })();

  let listContent: ReactElement | null = null;
  if (items.length > 0) {
    listContent = (
      <CommandGroup>
        {items.map((item) => {
          const disabledReason = getModelDisabledReason?.(item) ?? null;
          return (
            <ModelRow
              key={modelPickerValueKey(item.value)}
              item={item}
              selected={isSameModelPickerValue(value, item.value)}
              favoriteState={favoriteState}
              disabledReason={disabledReason}
              onSelect={() => {
                if (disabledReason) {
                  return;
                }
                onValueChange(item.value);
                setSearchQuery("");
                setOpen(false);
                onOpenChange?.(false);
              }}
            />
          );
        })}
      </CommandGroup>
    );
  } else if (emptyMessage) {
    listContent = (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
    );
  }

  const trigger = (
    <Button
      type="button"
      variant="outline"
      disabled={readOnlyReason !== null}
      title={readOnlyReason ?? undefined}
      aria-label={triggerAriaLabel}
      className={cn(
        "h-9 w-full min-w-0 justify-between border-input bg-card px-3 font-normal",
        triggerClassName,
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {triggerRuntime ? <AgentRuntimeIcon runtimeKind={triggerRuntime.kind} /> : null}
        <span className="truncate">{triggerModelLabel}</span>
      </span>
      <ChevronsUpDown className="text-muted-foreground" aria-hidden="true" />
    </Button>
  );

  return (
    <TooltipProvider>
      <Popover open={open} onOpenChange={handleOpenChange}>
        {readOnlyReason ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block">{trigger}</span>
            </TooltipTrigger>
            <TooltipContent>{readOnlyReason}</TooltipContent>
          </Tooltip>
        ) : (
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        )}
        <PopoverContent
          portalContainer={portalContainer}
          className="w-[min(42rem,calc(100vw-2rem))] overflow-hidden p-0"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
        >
          <div className="grid min-h-72 grid-cols-[3.5rem_minmax(0,1fr)]">
            <div className="flex flex-col items-center gap-1 border-r border-border bg-muted/40 p-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="icon"
                    variant={activeView === "favorites" ? "secondary" : "ghost"}
                    className={cn("size-9", activeView === "favorites" && "ring-1 ring-ring")}
                    aria-label="Favorite models"
                    aria-pressed={activeView === "favorites"}
                    onClick={() => {
                      setActiveView("favorites");
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <Star aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right">Favorites</TooltipContent>
              </Tooltip>
              {runtimes.map((runtime) => {
                const policyDisabledReason =
                  selectionPolicy.kind === "runtime_locked" &&
                  runtime.descriptor.kind !== selectionPolicy.runtimeKind
                    ? selectionPolicy.reason
                    : null;
                return (
                  <RuntimeRailButton
                    key={runtime.descriptor.kind}
                    runtime={runtime}
                    active={activeView === runtime.descriptor.kind}
                    disabledReason={runtime.disabledReason ?? policyDisabledReason}
                    onSelect={() => {
                      setActiveView(runtime.descriptor.kind);
                      setSearchQuery("");
                      searchInputRef.current?.focus();
                    }}
                  />
                );
              })}
            </div>
            <Command shouldFilter={false} className="min-w-0 rounded-none">
              <CommandInput
                ref={searchInputRef}
                placeholder="Search models..."
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
              <FavoriteNotice state={favoriteState} />
              <CommandList className="max-h-80">
                {visibleResources.map((runtime) => (
                  <ResourceNotice key={runtime.descriptor.kind} runtime={runtime} />
                ))}
                {listContent}
              </CommandList>
            </Command>
          </div>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
