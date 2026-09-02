import {
  NOTIFICATION_KIND_VALUES,
  notificationCueSchema,
  notificationSoundSchema,
  type NotificationCue,
  type NotificationKind,
  type NotificationSettings,
  type NotificationTarget,
} from "@openducktor/contracts";
import { Bell, BellRing } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  NOTIFICATION_KIND_DESCRIPTIONS,
  NOTIFICATION_KIND_LABELS,
} from "@/features/notifications/catalogue";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { useNotificationTestControls } from "@/state/notifications/use-notification-test-controls";
import {
  createNotificationSoundOptions,
  notificationCueOptions,
  NotificationSoundPicker,
} from "./settings-notification-sound-picker";

type SegmentedOption<Value extends string> = {
  value: Value;
  label: string;
};

const targetOptions: SegmentedOption<NotificationTarget>[] = [
  { value: "in_app", label: "In-app" },
  { value: "os", label: "OS" },
  { value: "both", label: "Both" },
];

const osFocusOptions: SegmentedOption<NotificationSettings["osFocus"]>[] = [
  { value: "suppress_if_focused", label: "When unfocused" },
  { value: "always_send", label: "Always" },
];

const soundFocusOptions: SegmentedOption<NotificationSettings["soundFocus"]>[] = [
  { value: "mute_while_focused", label: "Mute when focused" },
  { value: "always_play", label: "Always play" },
];

const AGENT_KINDS = NOTIFICATION_KIND_VALUES.filter((kind) => kind.startsWith("agent."));
const WORKFLOW_KINDS = NOTIFICATION_KIND_VALUES.filter((kind) => kind.startsWith("workflow."));

type SettingsRadioGroupProps<Value extends string> = {
  label: string;
  idPrefix: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  disabled: boolean;
  onValueChange: (value: Value) => void;
};

function SettingsRadioGroup<Value extends string>({
  label,
  idPrefix,
  value,
  options,
  disabled,
  onValueChange,
}: SettingsRadioGroupProps<Value>): ReactElement {
  return (
    <RadioGroup
      aria-label={label}
      value={value}
      disabled={disabled}
      className="flex flex-wrap gap-x-5 gap-y-2"
      onValueChange={(nextValue) => {
        const option = options.find((candidate) => candidate.value === nextValue);
        if (option && option.value !== value) {
          onValueChange(option.value);
        }
      }}
    >
      {options.map((option) => {
        const optionId = `${idPrefix}-${option.value}`;
        return (
          <div key={option.value} className="flex items-center gap-2">
            <RadioGroupItem id={optionId} value={option.value} />
            <Label
              htmlFor={optionId}
              className="cursor-pointer text-sm font-normal text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-50"
            >
              {option.label}
            </Label>
          </div>
        );
      })}
    </RadioGroup>
  );
}

function NotificationSettingCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="grid content-between gap-4 rounded-md border border-border bg-card p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

type NotificationKindRowProps = {
  kind: NotificationKind;
  settings: NotificationSettings;
  disabled: boolean;
  onUpdate: (updater: (current: NotificationSettings) => NotificationSettings) => void;
  onPreview: (cue: NotificationCue) => void;
};

function NotificationKindRow({
  kind,
  settings,
  disabled,
  onUpdate,
  onPreview,
}: NotificationKindRowProps): ReactElement {
  const kindSettings = settings.kinds[kind];
  const kindLabel = NOTIFICATION_KIND_LABELS[kind];
  const updateKind = (next: Partial<typeof kindSettings>): void => {
    onUpdate((current) => ({
      ...current,
      kinds: {
        ...current.kinds,
        [kind]: { ...current.kinds[kind], ...next },
      },
    }));
  };

  return (
    <div className="grid gap-4 rounded-md border border-border bg-card p-4">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{kindLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {NOTIFICATION_KIND_DESCRIPTIONS[kind]}
          </p>
        </div>
        <Switch
          checked={kindSettings.enabled}
          disabled={disabled}
          aria-label={`Enable ${kindLabel}`}
          className="shrink-0"
          onCheckedChange={(enabled) => updateKind({ enabled })}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 content-start gap-2">
          <Label className="text-xs text-muted-foreground">Delivery</Label>
          <SettingsRadioGroup
            label={`Delivery for ${kindLabel}`}
            idPrefix={`notification-${kind}-target`}
            value={kindSettings.target}
            options={targetOptions}
            disabled={disabled || !kindSettings.enabled}
            onValueChange={(target) => updateKind({ target })}
          />
        </div>
        <div className="grid min-w-0 content-start gap-2">
          <Label className="text-xs text-muted-foreground">Sound</Label>
          <NotificationSoundPicker
            label={`Sound for ${kindLabel}`}
            value={kindSettings.sound}
            options={createNotificationSoundOptions(settings.globalCue)}
            disabled={disabled || !kindSettings.enabled}
            onValueChange={(sound) => updateKind({ sound: notificationSoundSchema.parse(sound) })}
            onPreview={onPreview}
          />
        </div>
      </div>
    </div>
  );
}

type NotificationKindGroupProps = {
  title: string;
  kinds: readonly NotificationKind[];
  settings: NotificationSettings;
  disabled: boolean;
  onUpdate: (updater: (current: NotificationSettings) => NotificationSettings) => void;
  onPreview: (cue: NotificationCue) => void;
};

function NotificationKindGroup({
  title,
  kinds,
  settings,
  disabled,
  onUpdate,
  onPreview,
}: NotificationKindGroupProps): ReactElement {
  return (
    <section className="grid gap-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <div className="grid gap-3 xl:grid-cols-2">
        {kinds.map((kind) => (
          <NotificationKindRow
            key={kind}
            kind={kind}
            settings={settings}
            disabled={disabled}
            onUpdate={onUpdate}
            onPreview={onPreview}
          />
        ))}
      </div>
    </section>
  );
}

type FocusSettingRowProps<Value extends string> = {
  title: string;
  description: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  disabled: boolean;
  onValueChange: (value: Value) => void;
};

function FocusSettingRow<Value extends string>({
  title,
  description,
  value,
  options,
  disabled,
  onValueChange,
}: FocusSettingRowProps<Value>): ReactElement {
  return (
    <NotificationSettingCard title={title} description={description}>
      <SettingsRadioGroup
        label={title}
        idPrefix={`notification-focus-${title.toLowerCase().replaceAll(" ", "-")}`}
        value={value}
        options={options}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </NotificationSettingCard>
  );
}

type SettingsNotificationsSectionProps = {
  notifications: NotificationSettings;
  disabled: boolean;
  onUpdateNotifications: (updater: (current: NotificationSettings) => NotificationSettings) => void;
};

export function SettingsNotificationsSection({
  notifications,
  disabled,
  onUpdateNotifications,
}: SettingsNotificationsSectionProps): ReactElement {
  const notificationRuntime = useNotificationContext();
  const {
    capability,
    capabilityDescription,
    isTesting,
    status: testStatus,
    testNotification,
  } = useNotificationTestControls(notifications);
  const previewCue = (cue: NotificationCue): void => {
    void notificationRuntime.previewCue(cue, notifications.volumePercent);
  };

  return (
    <div className="grid gap-6 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
        <p className="mt-2 text-xs text-muted-foreground">
          Choose which agent and workflow events notify you, where they appear, and which sound they
          play.
        </p>
      </div>

      <section className="grid gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Sound and focus</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Set the default sound, volume, and behavior while OpenDucktor has focus.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <NotificationSettingCard
            title="Default sound"
            description="New notification rules use this sound unless you choose another one."
          >
            <NotificationSoundPicker
              label="Default sound"
              value={notifications.globalCue}
              options={notificationCueOptions}
              disabled={disabled}
              onValueChange={(value) =>
                onUpdateNotifications((current) => ({
                  ...current,
                  globalCue: notificationCueSchema.parse(value),
                }))
              }
              onPreview={previewCue}
            />
          </NotificationSettingCard>
          <NotificationSettingCard
            title="Volume"
            description="Applies to every notification sound."
          >
            <div className="flex items-center gap-4">
              <Slider
                aria-label="Volume"
                min={0}
                max={100}
                step={1}
                value={[notifications.volumePercent]}
                disabled={disabled}
                onValueChange={(values) => {
                  const volumePercent = values[0];
                  if (volumePercent === undefined) {
                    return;
                  }
                  onUpdateNotifications((current) => ({ ...current, volumePercent }));
                }}
              />
              <output className="w-10 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                {notifications.volumePercent}%
              </output>
            </div>
          </NotificationSettingCard>
          <FocusSettingRow
            title="OS notifications"
            description="Show OS notices only when the app is unfocused, or show them at all times."
            value={notifications.osFocus}
            options={osFocusOptions}
            disabled={disabled}
            onValueChange={(osFocus) =>
              onUpdateNotifications((current) => ({ ...current, osFocus }))
            }
          />
          <FocusSettingRow
            title="Notification sounds"
            description="Mute sounds while the app has focus, or play them at all times."
            value={notifications.soundFocus}
            options={soundFocusOptions}
            disabled={disabled}
            onValueChange={(soundFocus) =>
              onUpdateNotifications((current) => ({ ...current, soundFocus }))
            }
          />
        </div>
      </section>

      <NotificationKindGroup
        title="Agent activity"
        kinds={AGENT_KINDS}
        settings={notifications}
        disabled={disabled}
        onUpdate={onUpdateNotifications}
        onPreview={previewCue}
      />
      <NotificationKindGroup
        title="Workflow changes"
        kinds={WORKFLOW_KINDS}
        settings={notifications}
        disabled={disabled}
        onUpdate={onUpdateNotifications}
        onPreview={previewCue}
      />

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">Test notifications</p>
          <p className="mt-1 text-xs text-muted-foreground">{capabilityDescription}</p>
          {capability?.supported && !capability.canGuaranteeSilent ? (
            <p className="mt-1 text-xs text-warning-muted">
              This platform cannot guarantee a silent OS notice. OpenDucktor still requests silent
              delivery.
            </p>
          ) : null}
          {notificationRuntime.osFailure ? (
            <p className="mt-1 text-xs text-destructive">
              Last OS error: {notificationRuntime.osFailure.message}
            </p>
          ) : null}
          {testStatus ? (
            <p className="mt-1 text-xs text-foreground" role="status">
              {testStatus}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isTesting}
            onClick={() => void testNotification("in_app")}
          >
            <Bell data-icon="inline-start" /> Test in-app
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || isTesting || capability?.supported === false}
            onClick={() => void testNotification("os")}
          >
            <BellRing data-icon="inline-start" /> Test OS
          </Button>
        </div>
      </section>
    </div>
  );
}
