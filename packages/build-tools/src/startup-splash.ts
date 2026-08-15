export const OPEN_DUCKTOR_STARTUP_BACKGROUND = "#ffffff";

const STARTUP_SPLASH_STYLES = `
:root {
  --odt-startup-background: ${OPEN_DUCKTOR_STARTUP_BACKGROUND};
  --odt-startup-primary: #5100ff;
  --odt-startup-title: #18181b;
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
  font-size: 1.875rem;
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

@media (prefers-reduced-motion: reduce) {
  .odt-startup {
    transition: none;
  }

  .odt-startup__field,
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
}
`;

const STARTUP_SPLASH_MARKUP = `
<div class="odt-startup__content">
  <div class="odt-startup__stage">
    <div class="odt-startup__field" aria-hidden="true"></div>
    <div class="odt-startup__field odt-startup__field--inner" aria-hidden="true"></div>
    <div class="odt-startup__pulse" aria-hidden="true"></div>
    <div class="odt-startup__pulse odt-startup__pulse--second" aria-hidden="true"></div>
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
  children: string;
  injectTo: "head-prepend" | "body-prepend";
};

export const createOpenDucktorStartupSplashPlugin = () => ({
  name: "openducktor-startup-splash",
  enforce: "pre" as const,
  transformIndexHtml: (): { tags: StartupSplashHtmlTag[] } => ({
    tags: [
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
