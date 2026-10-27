import {
  CHAT_DIFF_HEIGHT_VALUES,
  CHAT_DIFF_INDICATOR_VALUES,
  CHAT_DIFF_STYLE_VALUES,
  CHAT_HUNK_SEPARATOR_VALUES,
  CHAT_LINE_OVERFLOW_VALUES,
  type ChatDiffHeight,
  type ChatDiffIndicators,
  type ChatDiffStyle,
  type ChatHunkSeparators,
  type ChatLineOverflow,
  type ChatSettings,
} from "@openducktor/contracts";
import type { ReactElement } from "react";
import { isApplePlatform } from "@/lib/device-platform";
import { SettingsSwitchRow } from "./settings-switch-row";
import {
  type SettingsSegmentedOption,
  SettingsSegmentedOptionRow,
} from "./settings-segmented-option-row";

type SettingsChatSectionProps = {
  chat: ChatSettings;
  disabled: boolean;
  onUpdateChat: (updater: (current: ChatSettings) => ChatSettings) => void;
};

const toSegmentedOptions = <Value extends string>(
  values: readonly Value[],
  labelsByValue: Record<Value, string>,
): SettingsSegmentedOption<Value>[] =>
  values.map((value) => ({ value, label: labelsByValue[value] }));

const diffStyleOptions = toSegmentedOptions(CHAT_DIFF_STYLE_VALUES, {
  split: "Split",
  unified: "Unified",
} satisfies Record<ChatDiffStyle, string>);

const diffIndicatorOptions = toSegmentedOptions(CHAT_DIFF_INDICATOR_VALUES, {
  bars: "Bars",
  classic: "Classic",
  none: "None",
} satisfies Record<ChatDiffIndicators, string>);

const diffHeightOptions = toSegmentedOptions(CHAT_DIFF_HEIGHT_VALUES, {
  full: "Full",
  scroll: "Scroll",
} satisfies Record<ChatDiffHeight, string>);

const lineOverflowOptions = toSegmentedOptions(CHAT_LINE_OVERFLOW_VALUES, {
  wrap: "Wrap",
  scroll: "Scroll",
} satisfies Record<ChatLineOverflow, string>);

const hunkSeparatorOptions = toSegmentedOptions(CHAT_HUNK_SEPARATOR_VALUES, {
  "line-info": "Line info",
  "line-info-basic": "Line info basic",
  metadata: "Metadata",
  simple: "Simple",
} satisfies Record<ChatHunkSeparators, string>);

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
          Configure messages and display settings for Chats and Workflows.
        </p>
      </div>

      <SettingsSwitchRow
        title="Steer messages by default"
        description={`After you save, Enter and Send steer messages. ${isApplePlatform() ? "Cmd+Enter" : "Ctrl+Enter"} uses ordinary delivery, which queues messages while the session works or already has queued messages.`}
        checked={chat.steerMessagesByDefault}
        disabled={disabled}
        ariaLabel="Steer messages by default"
        onCheckedChange={(checked) =>
          onUpdateChat((current) => ({ ...current, steerMessagesByDefault: checked }))
        }
      />

      <SettingsSwitchRow
        title="Show Thinking Messages"
        description="Thinking messages are hidden by default. When enabled, they will appear in session transcripts after you save settings."
        checked={chat.showThinkingMessages}
        disabled={disabled}
        ariaLabel="Show thinking messages in session transcripts"
        onCheckedChange={(checked) =>
          onUpdateChat((current) => ({ ...current, showThinkingMessages: checked }))
        }
      />

      <SettingsSwitchRow
        title="Show conversation minimap"
        description="Shows your messages beside session transcripts. Changes apply after you save settings."
        checked={chat.showConversationMinimap}
        disabled={disabled}
        ariaLabel="Show conversation minimap beside session transcripts"
        onCheckedChange={(checked) =>
          onUpdateChat((current) => ({ ...current, showConversationMinimap: checked }))
        }
      />

      <SettingsSwitchRow
        title="Expand file diffs by default"
        description="File diffs in session transcripts will start expanded after you save settings."
        checked={chat.expandFileDiffsByDefault}
        disabled={disabled}
        ariaLabel="Expand file diffs by default in session transcripts"
        onCheckedChange={(checked) =>
          onUpdateChat((current) => ({ ...current, expandFileDiffsByDefault: checked }))
        }
      />

      <SettingsSegmentedOptionRow<ChatDiffStyle>
        title="Diff Style"
        description="Choose how file diffs are displayed in session transcripts."
        value={chat.diffStyle}
        options={diffStyleOptions}
        disabled={disabled}
        onValueChange={(diffStyle) => onUpdateChat((current) => ({ ...current, diffStyle }))}
      />

      <SettingsSegmentedOptionRow<ChatDiffIndicators>
        title="Diff Indicators"
        description="Choose the visual markers shown next to added and removed lines."
        value={chat.diffIndicators}
        options={diffIndicatorOptions}
        disabled={disabled}
        onValueChange={(diffIndicators) =>
          onUpdateChat((current) => ({ ...current, diffIndicators }))
        }
      />

      <SettingsSegmentedOptionRow<ChatDiffHeight>
        title="Diff Height"
        description="Choose whether transcript diffs expand fully or use the compact scroll area."
        value={chat.diffHeight}
        options={diffHeightOptions}
        disabled={disabled}
        onValueChange={(diffHeight) => onUpdateChat((current) => ({ ...current, diffHeight }))}
      />

      <SettingsSegmentedOptionRow<ChatLineOverflow>
        title="Line Overflow"
        description="Choose whether long diff lines wrap or require horizontal scrolling."
        value={chat.lineOverflow}
        options={lineOverflowOptions}
        disabled={disabled}
        onValueChange={(lineOverflow) => onUpdateChat((current) => ({ ...current, lineOverflow }))}
      />

      <SettingsSegmentedOptionRow<ChatHunkSeparators>
        title="Hunk Separators"
        description="Choose the separator style for collapsed unchanged regions in transcript diffs."
        value={chat.hunkSeparators}
        options={hunkSeparatorOptions}
        disabled={disabled}
        onValueChange={(hunkSeparators) =>
          onUpdateChat((current) => ({ ...current, hunkSeparators }))
        }
      />

      <div className="rounded-md border border-border bg-muted/60 p-3 text-xs text-muted-foreground">
        Changes to chat settings will take effect after you save your settings.
      </div>
    </div>
  );
}
