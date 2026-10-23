export const ARTIFACT_PREVIEW_BOOTSTRAP_PATH = "/artifact-preview-bootstrap";

export const artifactPreviewBootstrapResponse = (): Response => new Response(html, { headers });

const headers = {
  "Content-Type": "text/html; charset=utf-8",
  "Connection-Allowlist": "()",
  "Content-Security-Policy":
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri about:; form-action 'none'; sandbox allow-scripts",
  "Permissions-Policy":
    "accelerometer=(), ambient-light-sensor=(), autoplay=(), bluetooth=(), camera=(), clipboard-read=(), clipboard-write=(), display-capture=(), geolocation=(), gyroscope=(), hid=(), idle-detection=(), local-fonts=(), magnetometer=(), microphone=(), midi=(), payment=(), publickey-credentials-get=(), screen-wake-lock=(), serial=(), usb=(), web-share=(), xr-spatial-tracking=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-store",
};

// This document contains no task data. Only its exact parent can transfer a private channel.
// A srcdoc document inherits this local base so fragment links stay inside it.
const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Artifact preview</title>
<base href="about:srcdoc">
<style>html,body,iframe{width:100%;height:100%;margin:0;border:0}iframe{display:block}</style>
</head><body><script>
(() => {
  const start = (event) => {
    if (event.source !== parent || !event.data || event.data.type !== "odt-artifact-init" ||
        typeof event.data.generation !== "string" || event.data.generation.length > 128 ||
        event.ports.length !== 1) return;
    removeEventListener("message", start);
    const port = event.ports[0];
    const generation = event.data.generation;
    let frame;
    const stop = () => { if (frame) frame.remove(); port.close(); };
    addEventListener("pagehide", stop, { once: true });
    port.onmessage = ({ data }) => {
      if (!data || data.generation !== generation) return;
      if (data.type === "dispose") { stop(); return; }
      if (data.type !== "render" || typeof data.html !== "string" || frame) return;
      frame = document.createElement("iframe");
      frame.sandbox = "allow-scripts";
      frame.referrerPolicy = "no-referrer";
      frame.title = "Artifact content";
      frame.addEventListener("load", () => port.postMessage({ type: "displayed", generation }), { once: true });
      frame.srcdoc = data.html;
      document.body.append(frame);
    };
    port.postMessage({ type: "ready", generation });
  };
  addEventListener("message", start);
})();
</script></body></html>`;
