export interface ControlCenterDocumentOptions {
  cspSource: string;
  scriptUri: string;
  styleUri: string;
  nonce: string;
}

/** Returns a static, nonce-bound document. All styling and scripts are packaged assets. */
export function renderControlCenterDocument(options: ControlCenterDocumentOptions): string {
  const policy = [
    "default-src 'none'",
    `script-src 'nonce-${options.nonce}'`,
    `style-src ${options.cspSource}`,
    `font-src ${options.cspSource}`,
    `img-src ${options.cspSource}`,
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "worker-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
  return `<!DOCTYPE html>
<html lang="en" dir="ltr">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Voice Input Control Center</title>
    <link rel="stylesheet" href="${options.styleUri}">
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${options.nonce}" src="${options.scriptUri}"></script>
  </body>
</html>`;
}
