import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { htmlPreviewBootstrapResponse } from "./html-preview-bootstrap";
import {
  type Evaluation,
  type FrameTree,
  type Target,
  connectChromeDevTools as connect,
  waitForCondition,
} from "./test-support/chrome-cdp";

const executable = process.env.ODT_HTML_PREVIEW_CHROME;

// A fresh headless Chrome process can take longer than the workspace's one-second timeout.
test.skipIf(executable === undefined)(
  "runs published HTML in an opaque frame that keeps navigation and host access out",
  async () => {
    const profile = await mkdtemp(join(tmpdir(), "odt-html-preview-"));
    const requests: string[] = [];
    let published = "";
    let redirectPublished = "";
    let slowRedirectPublished = "";
    const parentPage = (
      html: string,
    ): string => `<!doctype html><style>html,body,iframe{margin:0;border:0;width:100%;height:100%}iframe{display:block}</style>
          <script>
          const frame = document.createElement('iframe');
          frame.sandbox = 'allow-scripts allow-forms';
          frame.referrerPolicy = 'no-referrer';
          window.displayed = new Promise(resolve => {
            const channel = new MessageChannel();
            window.setTheme = (css, surface) => channel.port1.postMessage({type:'theme', generation:'live', css, surface});
            window.resizes = [];
            window.openedLinks = [];
            window.escapes = 0;
            channel.port1.onmessage = ({data}) => {
              if (data.type === 'ready') channel.port1.postMessage({type:'render', generation:'live', html:${JSON.stringify(html).replaceAll("<", "\\u003c")}});
              if (data.type === 'displayed') resolve();
              if (data.type === 'resize') window.resizes.push(data.height);
              if (data.type === 'open-link') window.openedLinks.push(data.url);
              if (data.type === 'escape') window.escapes += 1;
              if (data.type === 'failed') {
                window.failed = true;
                channel.port1.postMessage({type:'dispose', generation:'live'});
              }
            };
            frame.onload = () => frame.contentWindow.postMessage({type:'odt-html-preview-init', generation:'live'}, '*', [channel.port2]);
          });
          frame.src = '/html-preview-bootstrap#odt-surface=' + encodeURIComponent(JSON.stringify({appearance:'dark',background:'rgb(17, 17, 17)'}));
          addEventListener('DOMContentLoaded', () => document.body.append(frame));
        </script>`;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        requests.push(pathname);
        if (pathname === "/html-preview-bootstrap") return htmlPreviewBootstrapResponse();
        if (pathname === "/redirect")
          return new Response(parentPage(redirectPublished), {
            headers: { "Content-Type": "text/html" },
          });
        if (pathname === "/slow-redirect")
          return new Response(parentPage(slowRedirectPublished), {
            headers: { "Content-Type": "text/html" },
          });
        if (pathname !== "/") return new Response("Unexpected preview request", { status: 400 });
        return new Response(parentPage(published), {
          headers: { "Content-Type": "text/html" },
        });
      },
    });
    const certificateDirectory = await mkdtemp(join(tmpdir(), "odt-html-preview-cert-"));
    const certificate = await new Promise<{ cert: string; key: string }>((resolve, reject) => {
      const openssl = spawn(
        "openssl",
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          join(certificateDirectory, "key.pem"),
          "-out",
          join(certificateDirectory, "cert.pem"),
          "-days",
          "1",
          "-subj",
          "/CN=127.0.0.1",
        ],
        { stdio: "ignore" },
      );
      openssl.once("error", reject);
      openssl.once("exit", (code) => {
        if (code !== 0) {
          reject(new Error(`openssl exited with code ${code}.`));
          return;
        }
        void Promise.all([
          readFile(join(certificateDirectory, "cert.pem"), "utf8"),
          readFile(join(certificateDirectory, "key.pem"), "utf8"),
        ]).then(([cert, key]) => resolve({ cert, key }), reject);
      });
    });
    const slowRequests: string[] = [];
    const slowServer = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      tls: certificate,
      fetch(request) {
        const pathname = new URL(request.url).pathname;
        slowRequests.push(pathname);
        if (pathname !== "/slow-image")
          return new Response("Unexpected slow asset request", { status: 404 });
        return new Response(
          new ReadableStream<Uint8Array>({
            start() {
              // The stream never closes. The image load stays pending past the start limit.
            },
          }),
          { headers: { "Content-Type": "image/png" } },
        );
      },
    });
    published = `<!doctype html><html lang="en" data-report="q4"><head id="report-head" data-mode="print"><style>body{margin:0;font:16px sans-serif}#heading{color:rgb(12, 34, 56)}</style><style data-odt-html-preview="">html{background:rgb(1, 2, 3)}</style></head><body>
      <h1 id="heading">Published report</h1>
      <img id="slow" src="${slowServer.url}slow-image" alt="">
      <button id="increment">Increment</button><output id="count">0</output>
      <a id="jump" href="#details">Details</a><p id="details">Details</p>
      <a id="external" href="https://example.com/blocked">Blocked link</a>
      <form id="form" action="${server.url}forbidden-form"><input name="value"><button id="submit" type="submit">Submit</button></form>
      <script>
        window.checks = { parentDenied: false, storageDenied: false, cookieDenied: false, violations: [] };
        window.headState = {
          headId: document.head.id,
          mode: document.head.dataset.mode,
          lang: document.documentElement.lang,
          report: document.documentElement.dataset.report,
        };
        try { parent.document.body; } catch { window.checks.parentDenied = true; }
        try { localStorage.setItem('published', 'private'); } catch { window.checks.storageDenied = true; }
        try { void document.cookie; } catch { window.checks.cookieDenied = true; }
        addEventListener('securitypolicyviolation', event => window.checks.violations.push(event.effectiveDirective));
        document.getElementById('increment').addEventListener('click', () => {
          const output = document.getElementById('count');
          output.value = String(Number(output.value) + 1);
        });
        window.popupDenied = window.open('${server.url}forbidden-window') === null;
        window.fetchDenied = fetch('${server.url}forbidden-fetch').then(() => false, () => true);
        addEventListener('message', event => {
          if (event.source !== parent || !event.data ||
              event.data.type !== 'odt-html-preview-theme' ||
              typeof event.data.css !== 'string') return;
          const style = document.querySelector('style[data-odt-html-preview]');
          if (style) style.textContent = event.data.css;
        });
        addEventListener('DOMContentLoaded', () => {
          parent.postMessage({type: 'odt-html-preview-resize', height: 321}, '*');
          setTimeout(() => parent.postMessage({type: 'odt-html-preview-resize', height: 999999}, '*'), 0);
        });
        window.imageDenied = new Promise(resolve => {
          const image = new Image();
          image.onload = () => resolve(false);
          image.onerror = () => resolve(true);
          image.src = '${server.url}forbidden-image';
        });
      </script></body></html>`;
    redirectPublished = `<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${server.url}redirected"></head><body><p>Redirecting</p></body></html>`;
    slowRedirectPublished = `<!doctype html><html><head><meta http-equiv="refresh" content="1;url=${server.url}slow-redirected"></head><body><p>Redirecting</p></body></html>`;
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
          "--ignore-certificate-errors",
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
      const evaluate = async <T = unknown>(
        expression: string,
        contextId?: number,
        requestSessionId = sessionId,
      ): Promise<T> => {
        const response = await cdp!.send<Evaluation>(
          "Runtime.evaluate",
          {
            expression,
            contextId,
            awaitPromise: true,
            returnByValue: true,
          },
          requestSessionId,
        );
        if (response.exceptionDetails)
          throw new Error(
            response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
          );
        // SAFETY: This test owns each expression and its expected result type.
        return response.result.value as T;
      };
      const targetIds = async (): Promise<Set<string>> =>
        new Set(
          (await cdp!.send<{ targetInfos: Target[] }>("Target.getTargets")).targetInfos.map(
            (target) => target.targetId,
          ),
        );
      const openPreviewPage = async (path: string): Promise<string> => {
        const targetId = (
          await cdp!.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" })
        ).targetId;
        const targetSessionId = (
          await cdp!.send<{ sessionId: string }>("Target.attachToTarget", {
            targetId,
            flatten: true,
          })
        ).sessionId;
        await cdp!.send("Page.enable", {}, targetSessionId);
        await cdp!.send("Runtime.enable", {}, targetSessionId);
        const pageLoaded = cdp!.next("Page.loadEventFired");
        await cdp!.send("Page.navigate", { url: `${server.url}${path}` }, targetSessionId);
        await pageLoaded;
        return targetSessionId;
      };
      const waitForPreviewFailure = async (
        targetSessionId: string,
        timeoutMs: number,
      ): Promise<boolean> => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          if (await evaluate<boolean>("window.failed === true", undefined, targetSessionId))
            return true;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return false;
      };
      const previewBootstrapSession = async (knownTargets: Set<string>): Promise<string> => {
        const target = (
          await cdp!.send<{ targetInfos: Target[] }>("Target.getTargets")
        ).targetInfos.find(
          (candidate) =>
            candidate.type === "iframe" &&
            !knownTargets.has(candidate.targetId) &&
            new URL(candidate.url).pathname === "/html-preview-bootstrap",
        );
        if (!target) throw new Error("Chrome did not create the preview bootstrap target.");
        const targetSessionId = (
          await cdp!.send<{ sessionId: string }>("Target.attachToTarget", {
            targetId: target.targetId,
            flatten: true,
          })
        ).sessionId;
        await cdp!.send("Runtime.enable", {}, targetSessionId);
        return targetSessionId;
      };
      const displayed = evaluate("window.displayed").then(
        () => true,
        () => false,
      );
      expect(
        await Promise.race([
          displayed,
          new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
        ]),
      ).toBe(true);
      await waitForCondition(
        () => evaluate<boolean>("window.resizes.length === 2"),
        "the page height messages",
      );
      expect(await evaluate("window.resizes")).toEqual([321, 20_000]);
      const { targetInfos } = await cdp.send<{ targetInfos: Target[] }>("Target.getTargets");
      const bootstrapTarget = targetInfos.find(
        (target) =>
          target.type === "iframe" && new URL(target.url).pathname === "/html-preview-bootstrap",
      );
      if (!bootstrapTarget) throw new Error("Chrome did not create the isolated bootstrap target.");
      const bootstrapSessionId = (
        await cdp.send<{ sessionId: string }>("Target.attachToTarget", {
          targetId: bootstrapTarget.targetId,
          flatten: true,
        })
      ).sessionId;
      sessionId = bootstrapSessionId;
      await cdp.send("Page.enable", {}, sessionId);
      await cdp.send("Runtime.enable", {}, sessionId);
      const childContext = async (): Promise<number> => {
        let contextId: number | undefined;
        await waitForCondition(async () => {
          const tree = (
            await cdp!.send<{ frameTree: FrameTree }>("Page.getFrameTree", {}, sessionId)
          ).frameTree;
          const child = tree.childFrames?.[0];
          contextId = child ? cdp!.contexts.get(child.frame.id) : undefined;
          return contextId !== undefined;
        }, "the page frame execution context");
        if (contextId === undefined) throw new Error("The page frame has no execution context.");
        return contextId;
      };
      const frame = await evaluate<{
        sandbox: string;
        referrerPolicy: string;
        hasAllow: boolean;
        srcdoc: string;
      }>(
        `(() => {
          const frame = document.querySelector('iframe');
          return {
            sandbox: frame.getAttribute('sandbox'),
            referrerPolicy: frame.getAttribute('referrerpolicy'),
            hasAllow: frame.hasAttribute('allow'),
            srcdoc: frame.srcdoc,
          };
        })()`,
      );
      expect(frame.sandbox).toBe("allow-scripts allow-forms");
      expect(frame.referrerPolicy).toBe("no-referrer");
      expect(frame.hasAllow).toBe(false);
      expect(frame.srcdoc).toBe(published);
      const page = await childContext();
      await waitForCondition(
        () => evaluate<boolean>("Boolean(window.checks)", page),
        "the published page checks",
      );
      await waitForCondition(() => slowRequests.includes("/slow-image"), "the slow image request");
      expect(slowRequests).toContain("/slow-image");
      expect(await evaluate("window.headState", page)).toEqual({
        headId: "report-head",
        mode: "print",
        lang: "en",
        report: "q4",
      });
      expect(
        await evaluate(
          `({
          heading: document.getElementById('heading').textContent,
          parentDenied: checks.parentDenied,
          storageDenied: checks.storageDenied,
          cookieDenied: checks.cookieDenied,
        })`,
          page,
        ),
      ).toEqual({
        heading: "Published report",
        parentDenied: true,
        storageDenied: true,
        cookieDenied: true,
      });
      expect(
        await evaluate(
          `(async () => {
          document.getElementById('increment').click();
          document.getElementById('increment').click();
          document.getElementById('jump').click();
          await new Promise(resolve => setTimeout(resolve, 100));
          return {
            count: document.getElementById('count').value,
            hash: location.hash,
          };
        })()`,
          page,
        ),
      ).toEqual({ count: "2", hash: "#details" });
      expect(await evaluate("window.fetchDenied", page)).toBe(true);
      expect(await evaluate("window.imageDenied", page)).toBe(true);
      expect(await evaluate("window.popupDenied", page)).toBe(true);
      const themeCss = ":root{--test:1}html{background:rgb(9, 9, 9)}";
      const nextSurface = { appearance: "light", background: "rgb(245, 245, 245)" };
      await evaluate(
        `window.setTheme(${JSON.stringify(themeCss)}, ${JSON.stringify(nextSurface)})`,
        undefined,
        parentSessionId,
      );
      await waitForCondition(
        () =>
          evaluate<boolean>(
            `document.querySelector('style[data-odt-html-preview]').textContent === ${JSON.stringify(themeCss)}`,
            page,
          ),
        "the live theme update",
      );
      expect(
        await evaluate<{ rootBg: string; frameBg: string }>(
          `({ rootBg: document.documentElement.style.background, frameBg: document.querySelector('iframe').style.background })`,
        ),
      ).toEqual({
        rootBg: "rgb(245, 245, 245)",
        frameBg: "rgb(245, 245, 245)",
      });
      // Verify open-link and escape forwarding from the inner page to the host port.
      await evaluate(
        `parent.postMessage({ type: 'odt-html-preview-open-link', url: 'https://example.com/docs' }, '*');
         parent.postMessage({ type: 'odt-html-preview-open-link', url: 'javascript:alert(1)' }, '*');
         parent.postMessage({ type: 'odt-html-preview-escape' }, '*');`,
        page,
      );
      await waitForCondition(
        () =>
          evaluate<boolean>(
            "window.openedLinks.length === 1 && window.escapes === 1",
            undefined,
            parentSessionId,
          ),
        "open-link and escape forwarding",
      );
      expect(await evaluate("window.openedLinks", undefined, parentSessionId)).toEqual([
        "https://example.com/docs",
      ]);
      const pagesBefore = (
        await cdp.send<{ targetInfos: Target[] }>("Target.getTargets")
      ).targetInfos.filter((target) => target.type === "page").length;
      await evaluate(
        `(() => {
        window.topNavigationDenied = false;
        try { top.location.href = '${server.url}forbidden-top'; } catch { window.topNavigationDenied = true; }
      })()`,
        page,
      );
      expect(await evaluate("window.topNavigationDenied", page)).toBe(true);
      await evaluate(
        `(() => {
        const link = document.createElement('a');
        link.href = '${server.url}forbidden-nav';
        link.target = '_self';
        link.textContent = 'Leave';
        document.body.append(link);
        link.click();
        document.getElementById('form').requestSubmit();
      })()`,
        page,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
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
      expect(requests.filter((pathname) => pathname === "/html-preview-bootstrap")).toHaveLength(1);
      expect(await evaluate("document.querySelector('iframe').srcdoc")).toContain(
        "Published report",
      );
      const postNavigationPage = await childContext();
      await evaluate(
        `window.__violations = [];
        addEventListener('securitypolicyviolation', event => {
          window.__violations.push({
            directive: event.effectiveDirective,
            documentURI: event.documentURI,
            blockedURI: event.blockedURI,
          });
        })`,
      );
      await evaluate(
        `setTimeout(() => document.getElementById('external').click(), 0)`,
        postNavigationPage,
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(await evaluate("window.__violations")).toEqual([
        {
          directive: "frame-src",
          documentURI: `${server.url}html-preview-bootstrap`,
          blockedURI: "https://example.com",
        },
      ]);
      const afterBlockedNavigationPage = await childContext();
      await waitForCondition(
        () =>
          evaluate<boolean>(
            "Boolean(document.getElementById('increment'))",
            afterBlockedNavigationPage,
          ),
        "the restored published page",
      );
      expect(
        await evaluate<boolean>(
          "Boolean(document.getElementById('increment'))",
          afterBlockedNavigationPage,
        ),
      ).toBe(true);
      expect(
        await evaluate(
          `(() => {
          document.getElementById('increment').click();
          return document.getElementById('count').value;
        })()`,
          afterBlockedNavigationPage,
        ),
      ).toBe("1");
      // A page that navigates away on every load must reach a stable error state, not a loop.
      const immediateTargets = await targetIds();
      const immediateSessionId = await openPreviewPage("redirect");
      expect(await waitForPreviewFailure(immediateSessionId, 5_000)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      expect(await evaluate<boolean>("window.failed === true", undefined, immediateSessionId)).toBe(
        true,
      );
      expect(await evaluate("1 + 1", undefined, immediateSessionId)).toBe(2);
      expect(requests.filter((pathname) => pathname === "/redirected")).toEqual([]);
      const immediateBootstrapSessionId = await previewBootstrapSession(immediateTargets);
      expect(
        await evaluate<boolean>(
          "document.querySelector('iframe') === null",
          undefined,
          immediateBootstrapSessionId,
        ),
      ).toBe(true);
      // A one-second refresh waits out each window, so the per-generation limit must stop it too.
      const slowTargets = await targetIds();
      const slowSessionId = await openPreviewPage("slow-redirect");
      expect(await waitForPreviewFailure(slowSessionId, 12_000)).toBe(true);
      expect(await evaluate("1 + 1", undefined, slowSessionId)).toBe(2);
      expect(requests.filter((pathname) => pathname === "/slow-redirected")).toEqual([]);
      const slowBootstrapSessionId = await previewBootstrapSession(slowTargets);
      expect(
        await evaluate<boolean>(
          "document.querySelector('iframe') === null",
          undefined,
          slowBootstrapSessionId,
        ),
      ).toBe(true);
    } finally {
      cdp?.close();
      chrome?.kill("SIGKILL");
      await exited;
      await server.stop(true);
      await slowServer.stop(true);
      await rm(profile, { recursive: true, force: true });
      await rm(certificateDirectory, { recursive: true, force: true });
    }
  },
  30_000,
);
