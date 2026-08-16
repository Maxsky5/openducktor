export const OPEN_DUCKTOR_STARTUP_BACKGROUND = "#ffffff";

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

.odt-startup__content {
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

@media (prefers-reduced-motion: reduce) {
  .odt-startup {
    transition: none;
  }

  .odt-startup__field,
  .odt-startup__orbit,
  .odt-startup__orbit-node,
  .odt-startup__mark {
    animation: none;
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
          "aria-live": "polite",
        },
        children: STARTUP_SPLASH_MARKUP,
        injectTo: "body-prepend",
      },
    ],
  }),
});
