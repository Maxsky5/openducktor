import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";
import { artifactPreviewBootstrapResponse } from "./artifact-preview-bootstrap";

const executable = process.env.ODT_ARTIFACT_PREVIEW_CHROME;

// A fresh headless Chrome process can take longer than the workspace's one-second timeout.
test.skipIf(executable === undefined)(
  "keeps authored fragment links local while preserving artifact isolation in Chrome",
  async () => {
    const profile = await mkdtemp(join(tmpdir(), "odt-artifact-preview-"));
    const requests: string[] = [];
    let artifact = "";
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        requests.push(pathname);
        if (pathname === "/artifact-preview-bootstrap") return artifactPreviewBootstrapResponse();
        if (pathname !== "/") return new Response("Unexpected artifact request", { status: 400 });
        return new Response(
          `<!doctype html><style>html,body,iframe{margin:0;border:0;width:100%;height:100%}iframe{display:block}</style><script>
          const frame = document.createElement('iframe');
          frame.sandbox = 'allow-scripts';
          frame.referrerPolicy = 'no-referrer';
          window.displayed = new Promise(resolve => {
            const channel = new MessageChannel();
            channel.port1.onmessage = ({data}) => {
              if (data.type === 'ready') channel.port1.postMessage({type:'render', generation:'live', html:${JSON.stringify(artifact).replaceAll("<", "\\u003c")}});
              if (data.type === 'displayed') resolve();
            };
            frame.onload = () => frame.contentWindow.postMessage({type:'odt-artifact-init', generation:'live'}, '*', [channel.port2]);
          });
          frame.src = '/artifact-preview-bootstrap';
          addEventListener('DOMContentLoaded', () => document.body.append(frame));
        </script>`,
          { headers: { "Content-Type": "text/html" } },
        );
      },
    });
    artifact = `<!doctype html><style>body{margin:0}#design{margin-top:1200px}#end{height:1200px}:target{color:rgb(255,0,0)}</style>
      <a id="design-link" href="#design">Design</a><a id="top-link" href="#">Top</a>
      <h2 id="design">Original artifact</h2><div id="end"></div><script>
        window.checks = {};
        try { parent.document.body; checks.parentDenied = false; } catch { checks.parentDenied = true; }
        try { localStorage.setItem('artifact', 'private'); checks.storageDenied = false; } catch { checks.storageDenied = true; }
        checks.violations = [];
        addEventListener('securitypolicyviolation', event => checks.violations.push(event.effectiveDirective));
        window.networkDenied = Promise.all([
          fetch('${server.url}forbidden-fetch').then(() => false, () => true),
          new Promise(resolve => { const image = new Image(); image.onload = () => resolve(false); image.onerror = () => resolve(true); image.src = '${server.url}forbidden-image'; })
        ]);
        const dynamic = document.createElement('a'); dynamic.id = 'dynamic-link'; dynamic.href = '#design'; dynamic.textContent = 'Dynamic'; document.body.prepend(dynamic);
      </script>`;
    let chrome: ReturnType<typeof spawn> | undefined;
    let exited = Promise.resolve();
    let cdp: Awaited<ReturnType<typeof connect>> | undefined;
    try {
      chrome = spawn(
        executable ?? "",
        [
          "--headless=new",
          "--remote-debugging-port=0",
          "--remote-debugging-address=127.0.0.1",
          `--user-data-dir=${profile}`,
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--disable-extensions",
          "--window-size=1000,800",
          "about:blank",
        ],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      const browserProcess = chrome;
      exited = new Promise<void>((resolve) => {
        browserProcess.once("exit", () => resolve());
        browserProcess.once("error", () => resolve());
      });
      const endpoint = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Test Chrome did not start CDP.")), 10_000);
        browserProcess.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        browserProcess.once("exit", () => {
          clearTimeout(timer);
          reject(new Error("Test Chrome exited before CDP started."));
        });
        browserProcess.stderr?.on("data", (chunk) => {
          const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(String(chunk))?.[1];
          if (endpoint) {
            clearTimeout(timer);
            resolve(endpoint);
          }
        });
      });
      cdp = await connect(endpoint);
      const { targetId } = await cdp.send<{ targetId: string }>("Target.createTarget", {
        url: "about:blank",
      });
      let { sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
        targetId,
        flatten: true,
      });
      const parentSessionId = sessionId;
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      const loaded = cdp.next("Page.loadEventFired");
      await cdp.send("Page.navigate", { url: String(server.url) }, sessionId);
      await loaded;
      const evaluate = async <T = unknown>(expression: string, contextId?: number): Promise<T> => {
        const response = await cdp!.send<Evaluation>(
          "Runtime.evaluate",
          {
            expression,
            contextId,
            awaitPromise: true,
            returnByValue: true,
          },
          sessionId,
        );
        if (response.exceptionDetails)
          throw new Error(
            response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
          );
        // SAFETY: This test owns each expression and its expected result type.
        return response.result.value as T;
      };
      await evaluate("window.displayed");
      expect(
        await evaluate(
          "document.querySelector('iframe').getBoundingClientRect().width === innerWidth",
        ),
      ).toBe(true);
      const { targetInfos } = await cdp.send<{ targetInfos: Target[] }>("Target.getTargets");
      const bootstrapTarget = targetInfos.find(
        (target) => target.type === "iframe" && target.url.endsWith("/artifact-preview-bootstrap"),
      );
      if (!bootstrapTarget) throw new Error("Chrome did not create the isolated bootstrap target.");
      ({ sessionId } = await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
        targetId: bootstrapTarget.targetId,
        flatten: true,
      }));
      await cdp.send("Runtime.enable", {}, sessionId);
      const bootstrap = (
        await cdp.send<{ frameTree: FrameTree }>("Page.getFrameTree", {}, sessionId)
      ).frameTree;
      const child = bootstrap.childFrames?.[0];
      if (!child) throw new Error("The bootstrap did not create the artifact frame.");
      const bootstrapContext = cdp.contexts.get(bootstrap.frame.id);
      const context = cdp.contexts.get(child.frame.id);
      expect(bootstrapContext).toBeDefined();
      expect(context).toBeDefined();
      expect(await evaluate("document.querySelector('iframe').srcdoc", bootstrapContext)).toBe(
        artifact,
      );
      expect(
        await evaluate(
          "document.querySelector('iframe').getBoundingClientRect().width === innerWidth",
          bootstrapContext,
        ),
      ).toBe(true);
      const follow = (id: string) =>
        evaluate<Fragment>(
          `(async () => {
        document.getElementById(${JSON.stringify(id)}).click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {hash:location.hash, scroll:scrollY, target:document.querySelector(':target')?.id, text:document.getElementById('design')?.textContent};
      })()`,
          context,
        );
      const first = await follow("design-link");
      expect(first).toMatchObject({ hash: "#design", target: "design", text: "Original artifact" });
      expect(first.scroll).toBeGreaterThan(1000);
      await evaluate("scrollTo(0,0)", context);
      expect((await follow("design-link")).scroll).toBeGreaterThan(1000);
      expect(await follow("top-link")).toMatchObject({
        hash: "",
        scroll: 0,
        text: "Original artifact",
      });
      expect(await follow("dynamic-link")).toMatchObject({
        hash: "#design",
        target: "design",
        text: "Original artifact",
      });
      expect(await evaluate("window.networkDenied", context)).toEqual([true, true]);
      expect(
        await evaluate(
          "({parentDenied:checks.parentDenied,storageDenied:checks.storageDenied})",
          context,
        ),
      ).toEqual({ parentDenied: true, storageDenied: true });
      const pagesBefore = (
        await cdp.send<{ targetInfos: Target[] }>("Target.getTargets")
      ).targetInfos.filter((target) => target.type === "page").length;
      expect(
        await evaluate(
          `(async () => {
        const base = document.createElement('base'); base.href = '${server.url}forbidden-base/'; document.head.prepend(base);
        const link = document.createElement('a'); link.href = '${server.url}forbidden-window'; link.target = '_blank'; document.body.append(link); link.click();
        link.target = '_top'; link.href = '${server.url}forbidden-top'; link.click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {base:document.baseURI,baseDenied:checks.violations.includes('base-uri'),fetchDenied:checks.violations.includes('connect-src'),imageDenied:checks.violations.includes('img-src')};
      })()`,
          context,
        ),
      ).toEqual({ base: "about:srcdoc", baseDenied: true, fetchDenied: true, imageDenied: true });
      expect(
        (await cdp.send<{ targetInfos: Target[] }>("Target.getTargets")).targetInfos.filter(
          (target) => target.type === "page",
        ),
      ).toHaveLength(pagesBefore);
      expect(
        (await cdp.send<{ frameTree: FrameTree }>("Page.getFrameTree", {}, parentSessionId))
          .frameTree.frame.url,
      ).toBe(String(server.url));
      expect(requests.filter((pathname) => pathname.startsWith("/forbidden"))).toEqual([]);
    } finally {
      cdp?.close();
      chrome?.kill("SIGKILL");
      await exited;
      await server.stop(true);
      await rm(profile, { recursive: true, force: true });
    }
  },
  30_000,
);

type CdpMessage = {
  id?: number;
  method?: string;
  params?: { context?: { id: number; auxData?: { isDefault?: boolean; frameId: string } } };
  result?: unknown;
  error?: { message: string };
};

type Target = { targetId: string; type: string; url: string };
type FrameTree = { frame: { id: string; url: string }; childFrames?: FrameTree[] };
type Evaluation = {
  result: { value: unknown };
  exceptionDetails?: { exception?: { description?: string }; text: string };
};
type Fragment = { hash: string; scroll: number; target?: string; text: string };
type CdpParameters = Record<string, string | number | boolean | undefined>;

const connect = async (endpoint: string) => {
  const socket = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  let sequence = 0;
  const pending = new Map<number, (message: CdpMessage) => void>();
  const listeners = new Set<(message: CdpMessage) => void>();
  const contexts = new Map<string, number>();
  socket.on("message", (data) => {
    const message: CdpMessage = JSON.parse(String(data));
    if (message.id !== undefined) pending.get(message.id)?.(message);
    if (message.method === "Runtime.executionContextCreated") {
      const context = message.params?.context;
      if (context?.auxData?.isDefault) contexts.set(context.auxData.frameId, context.id);
    }
    for (const listener of listeners) listener(message);
  });
  return {
    contexts,
    close: () => socket.close(),
    send: <T = unknown>(
      method: string,
      params: CdpParameters = {},
      sessionId?: string,
    ): Promise<T> => {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Chrome did not answer ${method}.`));
        }, 5_000);
        pending.set(id, (message) => {
          clearTimeout(timer);
          pending.delete(id);
          if (message.error) reject(new Error(message.error.message));
          else {
            // SAFETY: Each test call names the response type of its CDP method.
            resolve(message.result as T);
          }
        });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    next: (method: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          listeners.delete(listener);
          reject(new Error(`Chrome did not emit ${method}.`));
        }, 5_000);
        const listener = (message: CdpMessage) => {
          if (message.method !== method) return;
          clearTimeout(timer);
          listeners.delete(listener);
          resolve();
        };
        listeners.add(listener);
      }),
  };
};
