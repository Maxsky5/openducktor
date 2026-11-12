import {
  AppWindow,
  Cpu,
  Database,
  FolderGit2,
  Globe,
  Laptop,
  Lock,
  Monitor,
  Plug,
  Server,
  Smartphone,
  SquareTerminal,
} from "lucide-react";
import { defineDiagram } from "../define";

/**
 * Where the work runs. The host runs the harnesses, the terminals, and the MCP bridge, and it uses
 * the repositories and the task store. Other devices reach the host through Remote control.
 */
export const host = defineDiagram({
  name: "host",
  label:
    "Your computer runs the OpenDucktor host. The desktop app or the browser runner starts the host. MCP clients connect to it locally. The host runs the harnesses, the terminals, and the MCP bridge, and it uses the repositories and the task store on your computer. The mobile app and the hosted web client connect through Remote control.",
  nodes: {
    computer: { type: "zone", data: { title: "Your computer", Icon: Laptop } },
    desktop: { type: "item", data: { title: "Desktop app", Icon: Monitor } },
    browser: { type: "item", data: { title: "Browser runner", Icon: AppWindow } },
    mcpClient: { type: "item", data: { title: "MCP client", text: "Another agent", Icon: Plug } },
    host: { type: "zone", data: { title: "OpenDucktor host", Icon: Server, tone: "host" } },
    harnesses: {
      type: "item",
      data: { title: "Harnesses", text: "OpenCode, Codex, Claude Code", Icon: Cpu, tone: "host" },
    },
    terminals: { type: "item", data: { title: "Terminals", Icon: SquareTerminal, tone: "host" } },
    bridge: { type: "item", data: { title: "MCP bridge", Icon: Plug, tone: "host" } },
    repos: {
      type: "item",
      data: { title: "Repositories", text: "And the task worktrees", Icon: FolderGit2 },
    },
    store: {
      type: "item",
      data: { title: "Task store", text: "Tasks, sessions, artifacts", Icon: Database },
    },
    remote: { type: "zone", data: { title: "Other devices", Icon: Globe, tone: "remote" } },
    mobile: {
      type: "item",
      data: { title: "Mobile app", text: "iOS and Android", Icon: Smartphone },
    },
    web: {
      type: "item",
      data: { title: "Hosted web client", text: "app.openducktor.dev", Icon: Globe },
    },
  },
  // Desktop: the local apps on the left of the host, the repositories and the task store under
  // it, and the other devices on the right, level with your computer. Every line is straight.
  wide: {
    width: 1090,
    height: 490,
    boxes: {
      computer: { x: 0, y: 0, w: 680, h: 490 },
      desktop: { x: 20, y: 96, w: 180, h: 60, in: "computer" },
      browser: { x: 20, y: 176, w: 180, h: 60, in: "computer" },
      mcpClient: { x: 20, y: 256, w: 180, h: 60, in: "computer" },
      host: { x: 250, y: 44, w: 360, h: 292, in: "computer" },
      harnesses: { x: 20, y: 52, w: 320, h: 60, in: "host" },
      terminals: { x: 20, y: 132, w: 320, h: 60, in: "host" },
      bridge: { x: 20, y: 212, w: 320, h: 60, in: "host" },
      repos: { x: 220, y: 410, w: 200, h: 60, in: "computer" },
      store: { x: 440, y: 410, w: 200, h: 60, in: "computer" },
      remote: { x: 860, y: 145, w: 230, h: 200 },
      mobile: { x: 20, y: 50, w: 190, h: 60, in: "remote" },
      web: { x: 20, y: 124, w: 190, h: 60, in: "remote" },
    },
    edges: [
      ["desktop.r", "host.l", { align: "source" }],
      ["browser.r", "host.l", { align: "source" }],
      ["mcpClient.r", "bridge.l"],
      ["host.b", "repos.t", { align: "target" }],
      ["host.b", "store.t", { align: "target" }],
      ["remote.l", "host.r", { align: "source", label: "Remote control", kind: "remote" }],
    ],
  },
  // Phone: your computer on top, with straight lines down, and the other devices under it. Their
  // line goes up to the host between the repositories and the task store.
  narrow: {
    width: 340,
    height: 912,
    boxes: {
      computer: { x: 0, y: 0, w: 340, h: 664 },
      desktop: { x: 12, y: 46, w: 152, h: 60, in: "computer" },
      browser: { x: 176, y: 46, w: 152, h: 60, in: "computer" },
      mcpClient: { x: 100, y: 120, w: 140, h: 60, in: "computer" },
      host: { x: 12, y: 230, w: 316, h: 250, in: "computer" },
      harnesses: { x: 14, y: 46, w: 288, h: 56, in: "host" },
      terminals: { x: 14, y: 112, w: 288, h: 56, in: "host" },
      bridge: { x: 14, y: 178, w: 288, h: 56, in: "host" },
      repos: { x: 12, y: 560, w: 148, h: 88, in: "computer" },
      store: { x: 180, y: 560, w: 148, h: 88, in: "computer" },
      remote: { x: 0, y: 724, w: 340, h: 188 },
      mobile: { x: 12, y: 46, w: 316, h: 60, in: "remote" },
      web: { x: 12, y: 116, w: 316, h: 60, in: "remote" },
    },
    data: { remote: { title: "Other devices, through Remote control" } },
    edges: [
      ["desktop.b", "host.t", { align: "source" }],
      ["browser.b", "host.t", { align: "source" }],
      ["mcpClient.b", "host.t"],
      ["host.b", "repos.t", { align: "target" }],
      ["host.b", "store.t", { align: "target" }],
      ["remote.t", "host.b", { kind: "remote" }],
    ],
  },
});

const ANY = { label: "http:// or https://", still: true };
const HTTPS = { label: "https:// only", still: true };

/** Which address each client of a shared host can use. */
export const remoteAccess = defineDiagram({
  name: "remote-access",
  label:
    "The OpenDucktor host runs the agents. The mobile app on a phone, and the desktop app or browser runner on another computer, connect to the host at an http:// or https:// address. app.openducktor.dev in any browser needs an https:// address, so it connects through an HTTPS proxy, for example Tailscale Serve, in front of the host.",
  nodes: {
    mobile: { type: "item", data: { title: "Phone", text: "Mobile app", Icon: Smartphone } },
    app: {
      type: "item",
      data: { title: "Another computer", text: "Desktop app or browser runner", Icon: Monitor },
    },
    web: { type: "item", data: { title: "Any browser", text: "app.openducktor.dev", Icon: Globe } },
    proxy: {
      type: "item",
      data: { title: "HTTPS proxy", text: "For example Tailscale Serve", Icon: Lock },
    },
    host: {
      type: "item",
      data: { title: "OpenDucktor host", text: "Runs the agents", Icon: Laptop, tone: "system" },
    },
  },
  // Desktop: the clients on the left, the host on the right.
  wide: {
    width: 860,
    height: 266,
    boxes: {
      mobile: { x: 1, y: 1, w: 250, h: 64 },
      app: { x: 1, y: 101, w: 250, h: 64 },
      web: { x: 1, y: 201, w: 250, h: 64 },
      proxy: { x: 380, y: 201, w: 235, h: 64 },
      host: { x: 660, y: 95, w: 199, h: 76 },
    },
    ports: {
      host: [
        { id: "in1", side: "left", at: 14 },
        { id: "in2", side: "left", at: 62 },
      ],
    },
    edges: [
      ["mobile.r", "host.in1", { ...ANY, step: true }],
      ["app.r", "host.l", { ...ANY, align: "source" }],
      ["web.r", "proxy.l", HTTPS],
      ["proxy.r", "host.in2", { still: true, step: true }],
    ],
  },
  // Phone: the direct clients above the host, the hosted web client below it.
  narrow: {
    width: 320,
    height: 462,
    boxes: {
      mobile: { x: 0, y: 0, w: 150, h: 76 },
      app: { x: 170, y: 0, w: 150, h: 76 },
      host: { x: 0, y: 162, w: 320, h: 64 },
      proxy: { x: 0, y: 284, w: 320, h: 56 },
      web: { x: 0, y: 406, w: 320, h: 56 },
    },
    // The phone column is too narrow for the full title.
    data: { app: { title: "Computer" } },
    edges: [
      ["mobile.b", "host.t", { ...ANY, align: "source" }],
      ["app.b", "host.t", { ...ANY, align: "source" }],
      ["web.t", "proxy.b", HTTPS],
      ["proxy.t", "host.b", { still: true }],
    ],
  },
});
