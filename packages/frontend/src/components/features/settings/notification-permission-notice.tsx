import type { NotificationOsCapability } from "@openducktor/contracts";
import { BellRing, CircleAlert, CircleCheck, Settings } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";

type NotificationPermissionNoticeProps = {
  capability: NotificationOsCapability | undefined;
  description: string;
  disabled: boolean;
  isRequestingPermission: boolean;
  onRequestPermission(): Promise<void>;
  onOpenSystemSettings(): Promise<void>;
};

export function NotificationPermissionNotice({
  capability,
  description,
  disabled,
  isRequestingPermission,
  onRequestPermission,
  onOpenSystemSettings,
}: NotificationPermissionNoticeProps): ReactElement {
  const canRequestPermission =
    capability?.platform === "browser" &&
    capability.supported &&
    capability.permission === "prompt";
  const notice = getNotice(capability);
  const Icon = notice.icon;
  return (
    <div
      className={`flex flex-col gap-4 rounded-md border px-4 py-4 sm:flex-row sm:items-center sm:justify-between ${notice.className}`}
      role={notice.role}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div
          className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md border ${notice.iconClassName}`}
        >
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{notice.title}</p>
          <p className="mt-1 text-sm leading-5">{description}</p>
          {capability?.supported && !capability.canGuaranteeSilent ? (
            <p className="mt-1 text-sm leading-5">
              This platform cannot guarantee silent OS delivery.
            </p>
          ) : null}
        </div>
      </div>
      {canRequestPermission ? (
        <Button
          type="button"
          variant="outline"
          className="shrink-0 self-start sm:self-center"
          disabled={disabled}
          aria-busy={isRequestingPermission}
          onClick={() => void onRequestPermission()}
        >
          <BellRing data-icon="inline-start" />
          {isRequestingPermission ? "Waiting for permission…" : "Allow notifications"}
        </Button>
      ) : null}
      {capability?.canOpenSystemSettings === true ? (
        <Button
          type="button"
          variant="outline"
          className="shrink-0 self-start sm:self-center"
          disabled={disabled}
          onClick={() => void onOpenSystemSettings()}
        >
          <Settings data-icon="inline-start" /> Open system settings
        </Button>
      ) : null}
    </div>
  );
}

type Notice = {
  title: string;
  className: string;
  iconClassName: string;
  icon: typeof BellRing;
  role: "alert" | "status";
};

const warningStyle = {
  className: "border-warning-border bg-warning-surface text-warning-surface-foreground",
  iconClassName: "border-warning-border bg-background/60 text-warning-muted dark:bg-background/30",
};

const getNotice = (capability: NotificationOsCapability | undefined): Notice => {
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

  if (capability?.permission === "denied" || capability?.supported === false) {
    return {
      ...warningStyle,
      title:
        capability.permission === "denied"
          ? "OS notifications are off"
          : "OS notifications are unavailable",
      icon: CircleAlert,
      role: "alert",
    };
  }

  if (capability?.permission === "prompt") {
    return {
      ...warningStyle,
      title: "Turn on OS notifications",
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
