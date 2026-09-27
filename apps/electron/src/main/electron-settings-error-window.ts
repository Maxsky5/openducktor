const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/gu, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

export const renderInvalidSettingsErrorHtml = (message: string): string => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenDucktor settings error</title>
  <style>
    body { box-sizing: border-box; margin: 0; padding: 32px; color: #202124; background: #fff; font: 16px/1.5 system-ui, sans-serif; }
    h1 { margin: 0 0 20px; font-size: 24px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
    p { margin-top: 24px; }
    @media (prefers-color-scheme: dark) { body { color: #f4f4f4; background: #202124; } }
  </style>
</head>
<body>
  <h1>OpenDucktor cannot start</h1>
  <pre>${escapeHtml(message)}</pre>
  <p>Close OpenDucktor and restart it after you fix or move the file.</p>
</body>
</html>`;
