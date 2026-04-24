import type { KanbanSettings } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SettingsKanbanSectionProps = {
  kanban: KanbanSettings;
  disabled: boolean;
  onUpdateKanban: (updater: (current: KanbanSettings) => KanbanSettings) => void;
};

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
          Control how long completed tasks stay visible on the board.
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
      </div>
    </div>
  );
}
