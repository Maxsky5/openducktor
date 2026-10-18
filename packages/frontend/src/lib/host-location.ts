import { remoteEndpointSchema } from "@openducktor/contracts";

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
    return { kind: "remote", endpoint: parseHostEndpoint(endpoint, url.protocol) };
  }
  return { kind: localAvailable ? "local" : "picker" };
}

export function saveHostTarget(target: HostTarget, pageProtocol: string): void {
  const value =
    target.kind === "remote" ? parseHostEndpoint(target.endpoint, pageProtocol) : target.kind;
  try {
    localStorage.setItem(HOST_SELECTION_KEY, value);
  } catch (cause) {
    throw new Error("Could not save the host. Allow site storage in this browser and try again.", {
      cause,
    });
  }
}

export function parseHostEndpoint(value: string, pageProtocol: string): string {
  const endpoint = value.trim();
  const result = remoteEndpointSchema.safeParse(endpoint);
  if (!result.success) throw new Error(result.error.issues.map((issue) => issue.message).join(" "));
  const url = new URL(endpoint);
  if (pageProtocol === "https:" && url.protocol !== "https:") {
    throw new Error("This web app needs an HTTPS host address. Use the host's HTTPS endpoint.");
  }
  return url.href.replace(/\/$/, "");
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
