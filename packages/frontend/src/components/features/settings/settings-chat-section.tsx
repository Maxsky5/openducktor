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
import { Switch } from "@/components/ui/switch";
import {
  type SettingsSegmentedOption,
  SettingsSegmentedOptionRow,
} from "./settings-segmented-option-row";

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

      <SettingsSegmentedOptionRow<ChatDiffStyle>
        title="Diff Style"
        description="Choose how file diffs are displayed in Agent Studio transcripts."
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
