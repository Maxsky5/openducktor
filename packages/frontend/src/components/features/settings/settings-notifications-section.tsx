import {
  NOTIFICATION_KIND_VALUES,
  notificationCueSchema,
  notificationSoundSchema,
  type NotificationCue,
  type NotificationKind,
  type NotificationOsCapability,
  type NotificationSettings,
  type NotificationTarget,
} from "@openducktor/contracts";
import { Bell, BellRing, CircleAlert, CircleCheck, Settings } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupSegmentItem } from "@/components/ui/radio-group";
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

type PermissionNoticePresentation = {
  title: string;
  className: string;
  iconClassName: string;
  icon: typeof BellRing;
  role: "alert" | "status";
};

const getPermissionNoticePresentation = (
  capability: NotificationOsCapability | undefined,
): PermissionNoticePresentation => {
  if (capability?.supported && capability.permission === "granted") {
    return {
      title: "OS notifications are on",
      className: "border-success-border bg-success-surface text-success-surface-foreground",
      iconClassName:
        "border-success-border bg-background/60 text-success-muted dark:bg-background/30",
      icon: CircleCheck,
      role: "status",
    };
  }

  if (capability?.permission === "denied") {
    return {
      title: "OS notifications are off",
      className: "border-warning-border bg-warning-surface text-warning-surface-foreground",
      iconClassName:
        "border-warning-border bg-background/60 text-warning-muted dark:bg-background/30",
      icon: CircleAlert,
      role: "alert",
    };
  }

  if (capability?.supported === false) {
    return {
      title: "OS notifications are unavailable",
      className: "border-warning-border bg-warning-surface text-warning-surface-foreground",
      iconClassName:
        "border-warning-border bg-background/60 text-warning-muted dark:bg-background/30",
      icon: CircleAlert,
      role: "alert",
    };
  }

  if (capability?.permission === "prompt") {
    return {
      title: "Turn on OS notifications",
      className: "border-warning-border bg-warning-surface text-warning-surface-foreground",
      iconClassName:
        "border-warning-border bg-background/60 text-warning-muted dark:bg-background/30",
      icon: BellRing,
      role: "status",
    };
  }

  return {
    title: capability ? "OS notifications are available" : "Checking OS notifications",
    className: "border-border bg-muted/40 text-foreground",
    iconClassName: "border-border bg-background text-muted-foreground",
    icon: BellRing,
    role: "status",
  };
};

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
      data-variant="segmented"
      className="flex h-8 w-full items-center gap-1 rounded-lg bg-muted p-1"
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
          <RadioGroupSegmentItem
            key={option.value}
            id={optionId}
            value={option.value}
            className="text-foreground/70"
          >
            {option.label}
          </RadioGroupSegmentItem>
        );
      })}
    </RadioGroup>
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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start xl:grid-cols-[minmax(15rem,1fr)_15rem_minmax(12rem,14rem)_4rem] xl:items-center">
      <div className="min-w-0 sm:col-span-2 xl:col-span-1">
        <p className="text-sm font-medium text-foreground">{kindLabel}</p>
        <p className="mt-1 text-xs text-muted-foreground">{NOTIFICATION_KIND_DESCRIPTIONS[kind]}</p>
      </div>
      <div className="col-span-2 grid min-w-0 content-start gap-2 sm:col-span-1 sm:col-start-1 xl:col-start-2">
        <Label className="text-xs text-muted-foreground xl:sr-only">Delivery</Label>
        <SettingsRadioGroup
          label={`Delivery for ${kindLabel}`}
          idPrefix={`notification-${kind}-target`}
          value={kindSettings.target}
          options={targetOptions}
          disabled={disabled || !kindSettings.enabled}
          onValueChange={(target) => updateKind({ target })}
        />
      </div>
      <div className="col-span-2 grid min-w-0 content-start gap-2 sm:col-span-1 sm:col-start-2 xl:col-start-3">
        <Label className="text-xs text-muted-foreground xl:sr-only">Sound</Label>
        <NotificationSoundPicker
          label={`Sound for ${kindLabel}`}
          value={kindSettings.sound}
          options={createNotificationSoundOptions(settings.globalCue)}
          disabled={disabled || !kindSettings.enabled}
          onValueChange={(sound) => updateKind({ sound: notificationSoundSchema.parse(sound) })}
          onPreview={onPreview}
        />
      </div>
      <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3 xl:col-start-4 xl:justify-self-center">
        <Switch
          checked={kindSettings.enabled}
          disabled={disabled}
          aria-label={`Enable ${kindLabel}`}
          onCheckedChange={(enabled) => updateKind({ enabled })}
        />
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
      <div className="overflow-hidden rounded-md border border-border bg-card">
        <div className="hidden grid-cols-[minmax(15rem,1fr)_15rem_minmax(12rem,14rem)_4rem] items-center gap-4 border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium text-muted-foreground xl:grid">
          <span>Notification</span>
          <span>Delivery</span>
          <span>Sound</span>
          <span className="text-center">Enabled</span>
        </div>
        <div className="divide-y divide-border">
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
    <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] sm:items-center">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
      <SettingsRadioGroup
        label={title}
        idPrefix={`notification-focus-${title.toLowerCase().replaceAll(" ", "-")}`}
        value={value}
        options={options}
        disabled={disabled}
        onValueChange={onValueChange}
      />
    </div>
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
    isOpeningSettings,
    isTesting,
    openSystemSettings,
    status: testStatus,
    testNotification,
  } = useNotificationTestControls(notifications);
  const canOpenSystemSettings =
    capability?.platform === "electron" && capability.permission === "denied";
  const isOsTestDisabled = capability?.supported === false || capability?.permission === "denied";
  const permissionNotice = getPermissionNoticePresentation(capability);
  const PermissionIcon = permissionNotice.icon;
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

      <div
        className={`flex flex-col gap-4 rounded-md border px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${permissionNotice.className}`}
        role={permissionNotice.role}
      >
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border ${permissionNotice.iconClassName}`}
          >
            <PermissionIcon className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">{permissionNotice.title}</p>
            <p className="mt-1 text-sm leading-5">{capabilityDescription}</p>
            {capability?.supported && !capability.canGuaranteeSilent ? (
              <p className="mt-1 text-sm leading-5">
                This platform cannot guarantee silent OS delivery.
              </p>
            ) : null}
            {notificationRuntime.osFailure ? (
              <p className="mt-1 text-sm leading-5">
                Last OS error: {notificationRuntime.osFailure.message}
              </p>
            ) : null}
          </div>
        </div>
        {canOpenSystemSettings ? (
          <Button
            type="button"
            variant="outline"
            className="shrink-0 self-start sm:self-center"
            disabled={disabled || isOpeningSettings || isTesting}
            onClick={() => void openSystemSettings()}
          >
            <Settings data-icon="inline-start" /> Open system settings
          </Button>
        ) : null}
      </div>

      <section className="grid gap-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Test notifications</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Send a test without changing your notification settings.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={disabled || isOpeningSettings || isTesting}
              onClick={() => void testNotification("in_app")}
            >
              <Bell data-icon="inline-start" /> Test in-app
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={disabled || isOpeningSettings || isTesting || isOsTestDisabled}
              onClick={() => void testNotification("os")}
            >
              <BellRing data-icon="inline-start" /> Test OS
            </Button>
          </div>
        </div>
        {testStatus ? (
          <p className="text-xs text-foreground" role="status">
            {testStatus}
          </p>
        ) : null}
      </section>

      <section className="grid gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Sound and focus</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Set the default sound, volume, and behavior while OpenDucktor has focus.
          </p>
        </div>
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Default sound</p>
              <p className="mt-1 text-xs text-muted-foreground">
                New notification rules use this sound unless you choose another one.
              </p>
            </div>
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
          </div>
          <div className="grid gap-4 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Volume</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Applies to every notification sound.
              </p>
            </div>
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
          </div>
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
    </div>
  );
}
