import { parseRemoteHostEndpoint } from "@openducktor/frontend-core/recovery/remote-host-endpoint";

const HOST_SELECTION_KEY = "openducktor:host-selection";

export type HostTarget =
  | { kind: "local" }
  | { kind: "picker" }
  | { kind: "remote"; endpoint: string };
export type LocalHost = "electron" | "web";
export type HostSelection = {
  target: HostTarget;
  localHost: LocalHost | null;
  select(endpoint: string | null): Promise<void>;
  disconnect(): Promise<void>;
};

export function sameHostTarget(left: HostTarget, right: HostTarget): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "remote" && right.kind === "remote") return left.endpoint === right.endpoint;
  return true;
}

export function localHostLabel(host: LocalHost | null): string {
  if (host === "electron") return "Desktop app host";
  if (host === "web") return "Web runner host";
  return "No host selected";
}

export function readHostTarget(
  url: URL,
  localAvailable: boolean,
  defaultEndpoint?: string,
): HostTarget {
  let value: string | null;
  try {
    value = localStorage.getItem(HOST_SELECTION_KEY);
  } catch (cause) {
    throw new Error(
      "Could not read the saved host. Allow site storage in this browser and reload.",
      {
        cause,
      },
    );
  }
  if (value === "picker") return { kind: "picker" };
  if (value === "local") return { kind: localAvailable ? "local" : "picker" };
  const endpoint = value ?? defaultEndpoint;
  if (endpoint !== undefined && endpoint !== null) {
    return {
      kind: "remote",
      endpoint: parseRemoteHostEndpoint(endpoint, { requireHttps: url.protocol === "https:" }),
    };
  }
  return { kind: localAvailable ? "local" : "picker" };
}

export function saveHostTarget(target: HostTarget, pageProtocol: string): void {
  const value =
    target.kind === "remote"
      ? parseRemoteHostEndpoint(target.endpoint, { requireHttps: pageProtocol === "https:" })
      : target.kind;
  try {
    localStorage.setItem(HOST_SELECTION_KEY, value);
  } catch (cause) {
    throw new Error("Could not save the host. Allow site storage in this browser and try again.", {
      cause,
    });
  }
}

/** A new document drops the old host's module state, reads, and event callbacks together. */
export function hostLocation(current: URL, target: HostTarget): string {
  const url = new URL(current);
  if (url.protocol !== "file:") url.pathname = "/";
  url.search = "";
  url.hash = "";
  if (target.kind === "remote") url.hash = "/kanban";
  return url.href;
}
