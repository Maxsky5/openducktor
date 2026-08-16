export const OPEN_DUCKTOR_STARTUP_BACKGROUND = "#ffffff";
export const OPEN_DUCKTOR_STARTUP_DARK_BACKGROUND = "#111318";

const STARTUP_FONT_PATH = "./fonts/space-grotesk-latin-600.woff2";

const STARTUP_SPLASH_STYLES = `
@font-face {
  font-family: "Space Grotesk";
  font-style: normal;
  font-weight: 600;
  font-display: block;
  src: url("${STARTUP_FONT_PATH}") format("woff2");
}

:root {
  --odt-startup-background: ${OPEN_DUCKTOR_STARTUP_BACKGROUND};
  --odt-startup-primary: #5100ff;
  --odt-startup-title: #475569;
}

@media (prefers-color-scheme: dark) {
  :root {
    --odt-startup-background: ${OPEN_DUCKTOR_STARTUP_DARK_BACKGROUND};
    --odt-startup-title: #e2e8f0;
  }
}

:root.light {
  --odt-startup-background: ${OPEN_DUCKTOR_STARTUP_BACKGROUND};
  --odt-startup-title: #475569;
}

:root.dark {
  --odt-startup-background: ${OPEN_DUCKTOR_STARTUP_DARK_BACKGROUND};
  --odt-startup-title: #e2e8f0;
}

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
  background: var(--odt-startup-background);
}

.odt-startup {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: var(--odt-startup-background);
  color: var(--odt-startup-primary);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  opacity: 1;
  transition: opacity 160ms ease-out;
}

.odt-startup--leaving {
  pointer-events: none;
  opacity: 0;
}

.odt-startup__particles {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}

.odt-startup__particle {
  position: absolute;
  top: var(--top);
  left: var(--left);
  width: var(--size);
  height: var(--size);
  box-sizing: border-box;
  opacity: var(--opacity);
  animation: odt-startup-particle-drift var(--duration) ease-in-out var(--delay) infinite alternate;
  will-change: transform;
}

.odt-startup__particle--dot {
  border-radius: 50%;
  background: var(--odt-startup-primary);
}

.odt-startup__particle--ring {
  border: 1.5px solid var(--odt-startup-primary);
  border-radius: 50%;
}

.odt-startup__particle--spark::before {
  position: absolute;
  inset: 0;
  border-radius: 1.5px;
  background: var(--odt-startup-primary);
  content: "";
  transform: rotate(45deg);
}

.odt-startup__content {
  position: relative;
  z-index: 1;
  display: grid;
  justify-items: center;
  gap: 1.25rem;
}

.odt-startup__stage {
  position: relative;
  display: grid;
  width: 15rem;
  height: 15rem;
  place-items: center;
}

.odt-startup__field {
  position: absolute;
  width: 14.5rem;
  height: 14.5rem;
  border-radius: 4.5rem;
  background: rgba(81, 0, 255, 0.025);
  transform: rotate(9deg);
  animation: odt-startup-field 6s ease-in-out infinite alternate;
}

.odt-startup__field--inner {
  width: 11.5rem;
  height: 11.5rem;
  border: 1px solid rgba(81, 0, 255, 0.09);
  border-radius: 3.75rem;
  background: transparent;
  transform: rotate(-8deg);
  animation-name: odt-startup-field-inner;
  animation-direction: alternate-reverse;
  animation-duration: 7s;
}

.odt-startup__pulse {
  position: absolute;
  width: 8.5rem;
  height: 8.5rem;
  box-sizing: border-box;
  border: 1px solid rgba(81, 0, 255, 0.18);
  border-radius: 2.625rem;
  opacity: 0;
  animation: odt-startup-pulse 2.8s cubic-bezier(0.16, 1, 0.3, 1) infinite;
}

.odt-startup__pulse--second {
  animation-delay: 1.4s;
}

.odt-startup__orbit {
  position: absolute;
  width: 13rem;
  height: 13rem;
  box-sizing: border-box;
  border: 1px solid rgba(81, 0, 255, 0.12);
  border-radius: 4.125rem;
  animation: odt-startup-orbit 10s linear infinite;
  transform: rotate(18deg);
}

.odt-startup__orbit-node {
  position: absolute;
  display: grid;
  width: 1.125rem;
  height: 1.125rem;
  place-items: center;
  border: 1px solid rgba(81, 0, 255, 0.18);
  border-radius: 0.375rem;
  background: var(--odt-startup-background);
  box-shadow: 0 0.625rem 1.5rem rgba(81, 0, 255, 0.12);
  animation: odt-startup-orbit-node 10s linear infinite;
}

.odt-startup__orbit-node::after {
  width: 0.35rem;
  height: 0.35rem;
  border-radius: 0.1rem;
  background: var(--odt-startup-primary);
  content: "";
}

.odt-startup__orbit-node--first {
  top: -0.625rem;
  left: calc(50% - 0.5625rem);
}

.odt-startup__orbit-node--second {
  right: 0.625rem;
  bottom: -0.2rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 0.3rem;
}

.odt-startup__orbit-node--second::after {
  width: 0.25rem;
  height: 0.25rem;
}

.odt-startup__orbit-node--third {
  top: 4.2rem;
  left: -0.45rem;
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 0.25rem;
}

.odt-startup__orbit-node--third::after {
  width: 0.2rem;
  height: 0.2rem;
}

.odt-startup__mark {
  position: relative;
  z-index: 1;
  width: 7rem;
  height: 7rem;
  animation: odt-startup-breathe 3.2s ease-in-out infinite;
  border-radius: 2rem;
  box-shadow: 0 1.75rem 4rem rgba(81, 0, 255, 0.18);
}

.odt-startup__mark::before {
  position: absolute;
  inset: -0.5rem;
  z-index: -1;
  border-radius: 2.375rem;
  background: rgba(81, 0, 255, 0.055);
  content: "";
}

.odt-startup__mark img {
  display: block;
  width: 7rem;
  height: 7rem;
  border-radius: 2rem;
}

.odt-startup__title {
  margin: 0;
  color: var(--odt-startup-title);
  font-family: "Space Grotesk", "Avenir Next", "Segoe UI", sans-serif;
  font-size: 2rem;
  font-weight: 600;
  letter-spacing: -0.045em;
  line-height: 1;
}

.odt-startup__failure {
  position: absolute;
  top: calc(50% + 10rem);
  display: none;
  width: min(24rem, calc(100vw - 3rem));
  margin: 0;
  color: rgba(81, 0, 255, 0.72);
  font-size: 0.875rem;
  line-height: 1.5;
  text-align: center;
}

.odt-startup--failed .odt-startup__field,
.odt-startup--failed .odt-startup__orbit,
.odt-startup--failed .odt-startup__orbit-node,
.odt-startup--failed .odt-startup__particle,
.odt-startup--failed .odt-startup__mark {
  animation: none;
}

.odt-startup--failed .odt-startup__pulse {
  display: none;
}

.odt-startup--failed .odt-startup__failure {
  display: block;
}

@keyframes odt-startup-field {
  from {
    transform: rotate(9deg) scale(0.985);
  }

  to {
    transform: rotate(13deg) scale(1.015);
  }
}

@keyframes odt-startup-field-inner {
  from {
    transform: rotate(-8deg) scale(0.99);
  }

  to {
    transform: rotate(-12deg) scale(1.01);
  }
}

@keyframes odt-startup-pulse {
  0% {
    opacity: 0.45;
    transform: scale(0.82);
  }

  100% {
    opacity: 0;
    transform: scale(1.62);
  }
}

@keyframes odt-startup-breathe {
  0%,
  100% {
    transform: scale(1);
  }

  50% {
    transform: scale(1.035);
  }
}

@keyframes odt-startup-orbit {
  from {
    transform: rotate(18deg);
  }

  to {
    transform: rotate(378deg);
  }
}

@keyframes odt-startup-orbit-node {
  from {
    transform: rotate(-18deg);
  }

  to {
    transform: rotate(-378deg);
  }
}

@keyframes odt-startup-particle-drift {
  from {
    opacity: calc(var(--opacity) * 0.72);
    transform: translate3d(0, 0, 0) scale(0.92);
  }

  to {
    opacity: var(--opacity);
    transform: translate3d(var(--drift-x), var(--drift-y), 0) scale(1.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .odt-startup {
    transition: none;
  }

  .odt-startup__field,
  .odt-startup__orbit,
  .odt-startup__orbit-node,
  .odt-startup__particle,
  .odt-startup__mark {
    animation: none;
  }

  .odt-startup__particle {
    opacity: var(--opacity);
    will-change: auto;
  }

  .odt-startup__pulse {
    opacity: 0.14;
    animation: none;
    transform: scale(1.4);
  }

  .odt-startup__pulse--second {
    display: none;
  }

  .odt-startup__orbit {
    transform: rotate(18deg);
  }

  .odt-startup__orbit-node {
    transform: rotate(-18deg);
  }
}
`;

const STARTUP_SPLASH_MARKUP = `
<div class="odt-startup__particles" aria-hidden="true">
  <span class="odt-startup__particle odt-startup__particle--dot" style="--top: 9%; --left: 8%; --size: 6px; --opacity: 0.34; --drift-x: 18px; --drift-y: -10px; --duration: 12s; --delay: -4s"></span>
  <span class="odt-startup__particle odt-startup__particle--ring" style="--top: 17%; --left: 23%; --size: 13px; --opacity: 0.24; --drift-x: -12px; --drift-y: 17px; --duration: 15s; --delay: -8s"></span>
  <span class="odt-startup__particle odt-startup__particle--spark" style="--top: 8%; --left: 62%; --size: 7px; --opacity: 0.3; --drift-x: 14px; --drift-y: 13px; --duration: 11s; --delay: -6s"></span>
  <span class="odt-startup__particle odt-startup__particle--dot" style="--top: 14%; --left: 86%; --size: 5px; --opacity: 0.28; --drift-x: -19px; --drift-y: 9px; --duration: 14s; --delay: -2s"></span>
  <span class="odt-startup__particle odt-startup__particle--ring" style="--top: 32%; --left: 6%; --size: 10px; --opacity: 0.2; --drift-x: 15px; --drift-y: 14px; --duration: 13s; --delay: -9s"></span>
  <span class="odt-startup__particle odt-startup__particle--spark" style="--top: 42%; --left: 18%; --size: 6px; --opacity: 0.26; --drift-x: -10px; --drift-y: -16px; --duration: 10s; --delay: -5s"></span>
  <span class="odt-startup__particle odt-startup__particle--dot" style="--top: 35%; --left: 78%; --size: 7px; --opacity: 0.3; --drift-x: 12px; --drift-y: -14px; --duration: 16s; --delay: -11s"></span>
  <span class="odt-startup__particle odt-startup__particle--ring" style="--top: 43%; --left: 92%; --size: 14px; --opacity: 0.22; --drift-x: -17px; --drift-y: 11px; --duration: 15s; --delay: -3s"></span>
  <span class="odt-startup__particle odt-startup__particle--spark" style="--top: 59%; --left: 7%; --size: 8px; --opacity: 0.32; --drift-x: 13px; --drift-y: 15px; --duration: 12s; --delay: -7s"></span>
  <span class="odt-startup__particle odt-startup__particle--dot" style="--top: 64%; --left: 24%; --size: 5px; --opacity: 0.25; --drift-x: -15px; --drift-y: 10px; --duration: 14s; --delay: -10s"></span>
  <span class="odt-startup__particle odt-startup__particle--ring" style="--top: 61%; --left: 82%; --size: 11px; --opacity: 0.26; --drift-x: 10px; --drift-y: -13px; --duration: 11s; --delay: -1s"></span>
  <span class="odt-startup__particle odt-startup__particle--dot" style="--top: 72%; --left: 94%; --size: 6px; --opacity: 0.32; --drift-x: -18px; --drift-y: -9px; --duration: 13s; --delay: -6s"></span>
  <span class="odt-startup__particle odt-startup__particle--dot" style="--top: 84%; --left: 9%; --size: 7px; --opacity: 0.29; --drift-x: 16px; --drift-y: -12px; --duration: 15s; --delay: -12s"></span>
  <span class="odt-startup__particle odt-startup__particle--spark" style="--top: 89%; --left: 31%; --size: 6px; --opacity: 0.24; --drift-x: -11px; --drift-y: -15px; --duration: 10s; --delay: -4s"></span>
  <span class="odt-startup__particle odt-startup__particle--ring" style="--top: 82%; --left: 57%; --size: 15px; --opacity: 0.2; --drift-x: 14px; --drift-y: 10px; --duration: 16s; --delay: -9s"></span>
  <span class="odt-startup__particle odt-startup__particle--spark" style="--top: 88%; --left: 87%; --size: 8px; --opacity: 0.28; --drift-x: -13px; --drift-y: 12px; --duration: 12s; --delay: -5s"></span>
  <span class="odt-startup__particle odt-startup__particle--ring" style="--top: 24%; --left: 46%; --size: 9px; --opacity: 0.18; --drift-x: 12px; --drift-y: -14px; --duration: 14s; --delay: -7s"></span>
  <span class="odt-startup__particle odt-startup__particle--dot" style="--top: 76%; --left: 69%; --size: 5px; --opacity: 0.27; --drift-x: -14px; --drift-y: 13px; --duration: 11s; --delay: -3s"></span>
</div>
<div class="odt-startup__content">
  <div class="odt-startup__stage">
    <div class="odt-startup__field" aria-hidden="true"></div>
    <div class="odt-startup__field odt-startup__field--inner" aria-hidden="true"></div>
    <div class="odt-startup__pulse" aria-hidden="true"></div>
    <div class="odt-startup__pulse odt-startup__pulse--second" aria-hidden="true"></div>
    <div class="odt-startup__orbit" aria-hidden="true">
      <span class="odt-startup__orbit-node odt-startup__orbit-node--first"></span>
      <span class="odt-startup__orbit-node odt-startup__orbit-node--second"></span>
      <span class="odt-startup__orbit-node odt-startup__orbit-node--third"></span>
    </div>
    <div class="odt-startup__mark" aria-hidden="true">
      <img src="./favicon.svg" alt="" width="112" height="112" />
    </div>
  </div>
  <p class="odt-startup__title">OpenDucktor</p>
</div>
<p class="odt-startup__failure" data-odt-startup-status></p>
`;

type StartupSplashHtmlTag = {
  tag: string;
  attrs?: Record<string, string>;
  children?: string;
  injectTo: "head-prepend" | "body-prepend";
};

export const createOpenDucktorStartupSplashPlugin = () => ({
  name: "openducktor-startup-splash",
  enforce: "pre" as const,
  transformIndexHtml: (): { tags: StartupSplashHtmlTag[] } => ({
    tags: [
      {
        tag: "link",
        attrs: {
          rel: "preload",
          href: STARTUP_FONT_PATH,
          as: "font",
          type: "font/woff2",
          crossorigin: "anonymous",
        },
        injectTo: "head-prepend",
      },
      {
        tag: "style",
        attrs: { id: "openducktor-startup-styles" },
        children: STARTUP_SPLASH_STYLES,
        injectTo: "head-prepend",
      },
      {
        tag: "div",
        attrs: {
          id: "openducktor-startup",
          class: "odt-startup",
          role: "status",
          "aria-label": "OpenDucktor is starting",
        },
        children: STARTUP_SPLASH_MARKUP,
        injectTo: "body-prepend",
      },
    ],
  }),
});
