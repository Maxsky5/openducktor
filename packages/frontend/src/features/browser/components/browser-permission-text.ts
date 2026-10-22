import type { BrowserPermissionKind } from "@openducktor/contracts";
import { Bell, Camera, ClipboardPaste, type LucideIcon, MapPin, Mic } from "lucide-react";

type BrowserPermissionText = {
  icon: LucideIcon;
  /** The permission name in a list, such as the site menu. */
  label: string;
  /** What the page asks to do, after "asks to". */
  request: string;
};

export const BROWSER_PERMISSION_TEXT = {
  camera: {
    icon: Camera,
    label: "Camera",
    request: "use the camera",
  },
  microphone: {
    icon: Mic,
    label: "Microphone",
    request: "use the microphone",
  },
  geolocation: {
    icon: MapPin,
    label: "Location",
    request: "know the location",
  },
  notifications: {
    icon: Bell,
    label: "Notifications",
    request: "show notifications",
  },
  clipboard_read: {
    icon: ClipboardPaste,
    label: "Clipboard read",
    request: "read the clipboard",
  },
} satisfies Record<BrowserPermissionKind, BrowserPermissionText>;
