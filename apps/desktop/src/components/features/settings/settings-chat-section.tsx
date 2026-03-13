import type { ChatSettings } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Switch } from "@/components/ui/switch";

type SettingsChatSectionProps = {
  chat: ChatSettings;
  disabled: boolean;
  onUpdateChat: (updater: (current: ChatSettings) => ChatSettings) => void;
};

export function SettingsChatSection({
  chat,
  disabled,
  onUpdateChat,
}: SettingsChatSectionProps): ReactElement {
  return (
    <div className="grid gap-4 p-4">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Chat Settings</h3>
        <p className="text-xs text-muted-foreground">
          Configure chat display behavior for Agent Studio sessions.
        </p>
      </div>

      <div className="rounded-md border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">Show Thinking Messages</p>
            <p className="text-xs text-muted-foreground">
              Thinking messages are hidden by default. When enabled, they will appear in the Agent
              Studio transcript after you save settings.
            </p>
          </div>
          <Switch
            checked={chat.showThinkingMessages}
            onCheckedChange={(checked) => onUpdateChat(() => ({ showThinkingMessages: checked }))}
            disabled={disabled}
            aria-label="Show thinking messages in Agent Studio transcript"
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        Changes to chat settings will take effect after you save your settings.
      </div>
    </div>
  );
}
