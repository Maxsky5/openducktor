import type { ShortcutActionId } from "@openducktor/contracts";
import type { SelectOption } from "@openducktor/frontend-core/lib/select-option";
import type {
  ModelPickerFavoriteState,
  ModelPickerItem,
  ModelPickerRuntime,
  ModelPickerSelectionPolicy,
  ModelPickerValue,
} from "@openducktor/frontend-core/sessions/model-selection/model-picker-model";
import type { SpeedControlModel } from "@openducktor/frontend-core/sessions/model-selection/use-speed-control";
import type { Ref } from "react";

export type ModelPickerEffortOptions = {
  options: readonly SelectOption[];
  value: string | undefined;
  disabledReason?: string | null;
  onSelect: (variant: string) => Promise<void> | void;
};

export type ModelPickerProfileOptions = {
  options: readonly SelectOption[];
  value: string | undefined;
  disabledReason?: string | null;
  onSelect: (profileId: string) => void;
};

export type ModelPickerSpeedOptions = {
  control: SpeedControlModel | null;
};

export type ModelPickerOptionsPane = {
  effort: ModelPickerEffortOptions;
  profile?: ModelPickerProfileOptions | undefined;
  speed?: ModelPickerSpeedOptions | undefined;
};

export type ModelPickerProps = {
  runtimes: readonly ModelPickerRuntime[];
  value: ModelPickerValue | null;
  favoriteState: ModelPickerFavoriteState;
  selectionPolicy: ModelPickerSelectionPolicy;
  options: ModelPickerOptionsPane;
  triggerVariant?: "composer" | "form";
  closedTriggerDisabledReason?: string | null;
  onValueChange: (value: ModelPickerValue) => void;
  getModelDisabledReason?: (item: ModelPickerItem) => string | null;
  triggerClassName?: string;
  triggerRef?: Ref<HTMLButtonElement>;
  shortcutId?: ShortcutActionId;
  placeholder?: string;
  onOpenChange?: (open: boolean) => void;
  popoverSide?: "top" | "bottom";
  popoverAvoidCollisions?: boolean;
};
