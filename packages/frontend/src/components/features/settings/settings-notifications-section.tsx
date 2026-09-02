import {
  NOTIFICATION_CUE_VALUES,
  NOTIFICATION_KIND_VALUES,
  notificationCueSchema,
  notificationSoundSchema,
  type NotificationCue,
  type NotificationKind,
  type NotificationSettings,
  type NotificationTarget,
} from "@openducktor/contracts";
import { Bell, BellRing, Volume2 } from "lucide-react";
import type { ReactElement } from "react";
import {
  NOTIFICATION_KIND_DESCRIPTIONS,
  NOTIFICATION_KIND_LABELS,
} from "@/features/notifications/catalogue";
import { resolveNotificationCue } from "@/features/notifications/notification-sound";
import { useNotificationContext } from "@/state/notifications/notification-context";
import { useNotificationTestControls } from "@/state/notifications/use-notification-test-controls";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import {
  type SettingsSegmentedOption,
  SettingsSegmentedOptionRow,
} from "./settings-segmented-option-row";

const cueLabel = (cue: NotificationCue): string => cue.charAt(0).toUpperCase() + cue.slice(1);

const cueOptions: ComboboxOption[] = NOTIFICATION_CUE_VALUES.map((cue) => ({
  value: cue,
  label: cueLabel(cue),
}));

const soundOptions: ComboboxOption[] = [
  { value: "inherit", label: "Use global sound" },
  { value: "none", label: "No sound" },
  ...cueOptions,
];

const targetOptions: SettingsSegmentedOption<NotificationTarget>[] = [
  { value: "in_app", label: "In-app" },
  { value: "os", label: "OS" },
  { value: "both", label: "Both" },
];

const osFocusOptions: SettingsSegmentedOption<NotificationSettings["osFocus"]>[] = [
  { value: "suppress_if_focused", label: "Unfocused" },
  { value: "always_send", label: "Always" },
];

const soundFocusOptions: SettingsSegmentedOption<NotificationSettings["soundFocus"]>[] = [
  { value: "mute_while_focused", label: "Mute" },
  { value: "always_play", label: "Always" },
];

const AGENT_KINDS = NOTIFICATION_KIND_VALUES.filter((kind) => kind.startsWith("agent."));
const WORKFLOW_KINDS = NOTIFICATION_KIND_VALUES.filter((kind) => kind.startsWith("workflow."));

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
  const previewCue = resolveNotificationCue(kindSettings.sound, settings.globalCue);
  const soundLabelId = `notification-sound-label-${kind}`;
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
    <div className="grid gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-[minmax(14rem,1fr)_13rem_13rem] lg:items-center">
      <div className="flex items-start justify-between gap-4 lg:pr-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{kindLabel}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {NOTIFICATION_KIND_DESCRIPTIONS[kind]}
          </p>
        </div>
        <Switch
          checked={kindSettings.enabled}
          disabled={disabled}
          aria-label={`Enable ${kindLabel}`}
          onCheckedChange={(enabled) => updateKind({ enabled })}
        />
      </div>
      <div className="grid min-w-0 gap-2">
        <Label>Delivery</Label>
        <SegmentedControlRoot size="sm" className="w-full" aria-label={`Delivery for ${kindLabel}`}>
          {targetOptions.map((option) => (
            <SegmentedControlItem
              key={option.value}
              active={kindSettings.target === option.value}
              size="sm"
              disabled={disabled || !kindSettings.enabled}
              inactiveClassName="text-foreground/70 hover:text-foreground"
              onClick={() => {
                if (kindSettings.target !== option.value) {
                  updateKind({ target: option.value });
                }
              }}
            >
              {option.label}
            </SegmentedControlItem>
          ))}
        </SegmentedControlRoot>
      </div>
      <div className="grid gap-2">
        <Label id={soundLabelId}>Sound</Label>
        <div className="flex gap-2">
          <Combobox
            value={kindSettings.sound}
            options={soundOptions}
            disabled={disabled || !kindSettings.enabled}
            triggerClassName="min-w-0 flex-1"
            triggerAriaLabelledBy={soundLabelId}
            searchPlaceholder="Search sounds…"
            onValueChange={(sound) => updateKind({ sound: notificationSoundSchema.parse(sound) })}
          />
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label={`Preview ${kindLabel} sound`}
            disabled={disabled || !kindSettings.enabled || !previewCue}
            onClick={() => {
              if (previewCue) onPreview(previewCue);
            }}
          >
            <Volume2 aria-hidden="true" />
          </Button>
        </div>
      </div>
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
    isTesting,
    status: testStatus,
    testNotification,
  } = useNotificationTestControls(notifications);

  const renderKindGroup = (title: string, kinds: readonly NotificationKind[]): ReactElement => (
    <section className="grid gap-3">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      {kinds.map((kind) => (
        <NotificationKindRow
          key={kind}
          kind={kind}
          settings={notifications}
          disabled={disabled}
          onUpdate={onUpdateNotifications}
          onPreview={(cue) => {
            void notificationRuntime.previewCue(cue, notifications.volumePercent);
          }}
        />
      ))}
    </section>
  );

  return (
    <div className="grid gap-6 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Notifications</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose which agent and workflow events notify you, where they appear, and which sound they
          play.
        </p>
      </div>

      <section className="grid gap-4 rounded-lg border border-border bg-card p-4">
        <div className="grid gap-4 md:grid-cols-[minmax(12rem,1fr)_9rem_auto] md:items-end">
          <div className="grid gap-2">
            <Label>Global sound</Label>
            <Combobox
              value={notifications.globalCue}
              options={cueOptions}
              disabled={disabled}
              triggerClassName="w-full"
              searchPlaceholder="Search sounds…"
              onValueChange={(value) =>
                onUpdateNotifications((current) => ({
                  ...current,
                  globalCue: notificationCueSchema.parse(value),
                }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="notification-volume">Volume</Label>
            <Input
              id="notification-volume"
              type="number"
              min={0}
              max={100}
              value={notifications.volumePercent}
              disabled={disabled}
              onChange={(event) =>
                onUpdateNotifications((current) => ({
                  ...current,
                  volumePercent: Math.min(100, Math.max(0, Number(event.target.value))),
                }))
              }
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void notificationRuntime.previewCue(
                notifications.globalCue,
                notifications.volumePercent,
              )
            }
          >
            <Volume2 data-icon="inline-start" /> Preview sound
          </Button>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <SettingsSegmentedOptionRow
            title="OS notifications"
            description="Control notices while OpenDucktor has focus."
            value={notifications.osFocus}
            options={osFocusOptions}
            disabled={disabled}
            onValueChange={(osFocus) =>
              onUpdateNotifications((current) => ({ ...current, osFocus }))
            }
          />
          <SettingsSegmentedOptionRow
            title="Notification sounds"
            description="Control sounds while OpenDucktor has focus."
            value={notifications.soundFocus}
            options={soundFocusOptions}
            disabled={disabled}
            onValueChange={(soundFocus) =>
              onUpdateNotifications((current) => ({ ...current, soundFocus }))
            }
          />
        </div>
      </section>

      {renderKindGroup("Agent activity", AGENT_KINDS)}
      {renderKindGroup("Workflow changes", WORKFLOW_KINDS)}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
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
