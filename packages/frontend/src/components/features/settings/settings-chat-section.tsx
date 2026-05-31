import type { ChatSettings } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Switch } from "@/components/ui/switch";

type SettingsChatSectionProps = {
  chat: ChatSettings;
  disabled: boolean;
  onUpdateChat: (updater: (current: ChatSettings) => ChatSettings) => void;
};

type ChatSettingSwitchRowProps = {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  ariaLabel: string;
  onCheckedChange: (checked: boolean) => void;
};

function ChatSettingSwitchRow({
  title,
  description,
  checked,
  disabled,
  ariaLabel,
  onCheckedChange,
}: ChatSettingSwitchRowProps): ReactElement {
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-label={ariaLabel}
        />
      </div>
    </div>
  );
}

export function SettingsChatSection({
  chat,
  disabled,
  onUpdateChat,
}: SettingsChatSectionProps): ReactElement {
  return (
    <div className="grid gap-4 p-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-foreground">Chat Settings</h3>
        <p className="text-xs text-muted-foreground">
          Configure chat display behavior for Agent Studio sessions.
        </p>
      </div>

      <ChatSettingSwitchRow
        title="Show Thinking Messages"
        description="Thinking messages are hidden by default. When enabled, they will appear in the Agent Studio transcript after you save settings."
        checked={chat.showThinkingMessages}
        disabled={disabled}
        ariaLabel="Show thinking messages in Agent Studio transcript"
        onCheckedChange={(checked) =>
          onUpdateChat((current) => ({ ...current, showThinkingMessages: checked }))
        }
      />

      <ChatSettingSwitchRow
        title="Expand file diffs by default"
        description="File diffs in Agent Studio transcripts will start expanded after you save settings."
        checked={chat.expandFileDiffsByDefault}
        disabled={disabled}
        ariaLabel="Expand file diffs by default in Agent Studio transcripts"
        onCheckedChange={(checked) =>
          onUpdateChat((current) => ({ ...current, expandFileDiffsByDefault: checked }))
        }
      />

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        Changes to chat settings will take effect after you save your settings.
      </div>
    </div>
  );
}
