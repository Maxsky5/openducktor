import {
  KANBAN_EMPTY_COLUMN_DISPLAY_VALUES,
  type KanbanEmptyColumnDisplay,
  type KanbanSettings,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SettingsKanbanSectionProps = {
  kanban: KanbanSettings;
  disabled: boolean;
  onUpdateKanban: (updater: (current: KanbanSettings) => KanbanSettings) => void;
};

const EMPTY_COLUMN_DISPLAY_OPTIONS: ComboboxOption[] = [
  {
    value: "show",
    label: "Show",
    description: "Display empty columns normally.",
  },
  {
    value: "hidden",
    label: "Hidden",
    description: "Hide empty columns from the board.",
  },
  {
    value: "collapsed",
    label: "Collapsed",
    description: "Show a compact themed marker for each empty column.",
  },
];

const isKanbanEmptyColumnDisplay = (value: string): value is KanbanEmptyColumnDisplay =>
  KANBAN_EMPTY_COLUMN_DISPLAY_VALUES.includes(value as KanbanEmptyColumnDisplay);

export function SettingsKanbanSection({
  kanban,
  disabled,
  onUpdateKanban,
}: SettingsKanbanSectionProps): ReactElement {
  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Kanban Settings</h3>
        <p className="text-xs text-muted-foreground">
          Control completed-task visibility and how empty columns appear on the board.
        </p>
      </div>

      <div className="grid gap-3 rounded-md border border-border bg-card p-4">
        <div className="grid gap-2">
          <Label htmlFor="kanban-done-visible-days">Done tasks visible for</Label>
          <Input
            id="kanban-done-visible-days"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={kanban.doneVisibleDays}
            disabled={disabled}
            onChange={(event) => {
              if (disabled) {
                return;
              }

              const parsed = Number.parseInt(event.currentTarget.value, 10);
              onUpdateKanban((current) => ({
                ...current,
                doneVisibleDays: Number.isNaN(parsed) ? 0 : Math.max(0, parsed),
              }));
            }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Set to `0` to hide Done tasks by default. Changes take effect after you save settings.
        </p>
        <div className="grid gap-2 border-t border-border pt-3">
          <Label id="kanban-empty-column-display-label">Empty columns</Label>
          <Combobox
            value={kanban.emptyColumnDisplay}
            options={EMPTY_COLUMN_DISPLAY_OPTIONS}
            disabled={disabled}
            triggerAriaLabelledBy="kanban-empty-column-display-label"
            searchPlaceholder="Search display modes..."
            emptyText="No display mode found."
            onValueChange={(value) => {
              if (disabled) {
                return;
              }
              if (!isKanbanEmptyColumnDisplay(value)) {
                throw new Error(`Unsupported Kanban empty-column display mode: ${value}`);
              }

              onUpdateKanban((current) => ({
                ...current,
                emptyColumnDisplay: value,
              }));
            }}
          />
          <p className="text-xs text-muted-foreground">
            Choose whether empty lanes stay visible, disappear, or collapse to a themed marker.
          </p>
        </div>
      </div>
    </div>
  );
}
