export const MIC_VIEW_STYLES = `
  :root {
    color-scheme: light dark;
    --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
    --radius-s: 6px; --radius-m: 10px;
    --speed: 160ms;
    --border: var(--vscode-widget-border, var(--vscode-panel-border));
    --surface: var(--vscode-sideBar-background);
    --raised: var(--vscode-editorWidget-background, var(--surface));
    --muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
    --focus: var(--vscode-focusBorder, var(--vscode-contrastActiveBorder));
    --danger: var(--vscode-errorForeground, var(--vscode-foreground));
    --accent: var(--vscode-focusBorder, var(--vscode-button-background));
    --accent-2: var(--vscode-charts-purple, var(--accent));
    --info: var(--vscode-charts-blue, var(--accent));
    --shadow: var(--vscode-widget-shadow, transparent);
    --tint-hover: color-mix(in srgb, var(--vscode-foreground) 6%, transparent);
  }
  * { box-sizing: border-box; }
  html, body { min-width: 0; margin: 0; overflow-x: hidden; color: var(--vscode-foreground); background: var(--surface); font: var(--vscode-font-size, 13px)/1.5 var(--vscode-font-family); }
  #compact-mic-main { display: grid; gap: var(--space-3); min-width: 0; padding: var(--space-3); }
  .compact-header, .compact-section { min-width: 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius-m); background: var(--raised); box-shadow: 0 1px 3px var(--shadow); }
  .title-row, .deep-links { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .title-row { justify-content: space-between; }
  h1 { display: inline-flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 1.25rem; line-height: 1.25; letter-spacing: -0.01em; }
  h1::before { content: ""; flex: none; width: 0.6em; height: 0.6em; border-radius: 999px; background: linear-gradient(135deg, var(--info), var(--accent-2)); box-shadow: 0 0 8px color-mix(in srgb, var(--info) 45%, transparent); }
  h2 { margin-block: 0 var(--space-2); font-size: 1rem; letter-spacing: -0.01em; }
  p { margin-block: var(--space-1); overflow-wrap: anywhere; }
  .provider-status, .muted, .shortcut { color: var(--muted); }
  button { min-width: 44px; min-height: 44px; max-width: 100%; padding: var(--space-2) var(--space-3); border: 1px solid var(--vscode-button-border, transparent); border-radius: var(--radius-s); color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; font-weight: 500; transition: background var(--speed) ease, border-color var(--speed) ease, box-shadow var(--speed) ease, transform var(--speed) ease; }
  button:not(:disabled) { cursor: pointer; }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); box-shadow: 0 2px 8px var(--shadow); }
  button:active:not(:disabled) { transform: translateY(1px); box-shadow: none; }
  button:disabled { opacity: 0.6; cursor: not-allowed; }
  .secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground, transparent); border-color: var(--border); }
  .secondary:hover:not(:disabled) { background: var(--tint-hover); border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
  .auto-kill { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent); border-color: color-mix(in srgb, var(--danger) 55%, transparent); font-weight: 700; }
  .auto-kill:hover:not(:disabled) { background: color-mix(in srgb, var(--danger) 18%, transparent); }
  .mic-btn { width: 100%; font-weight: 700; background: linear-gradient(135deg, var(--vscode-button-background), color-mix(in srgb, var(--vscode-button-background) 72%, var(--accent-2))); }
  .mic-btn:hover:not(:disabled) { background: linear-gradient(135deg, var(--vscode-button-hoverBackground), color-mix(in srgb, var(--vscode-button-hoverBackground) 72%, var(--accent-2))); box-shadow: 0 3px 12px color-mix(in srgb, var(--accent) 30%, transparent); }
  .mic-btn[aria-pressed="true"] { border-color: color-mix(in srgb, var(--danger) 60%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--danger) 25%, transparent); }
  .launcher-section > #open-control-center { width: 100%; }
  .deep-links { margin-block-start: var(--space-2); }
  .deep-links > button { flex: 1 1 8rem; }
  kbd { padding: 2px 6px; border: 1px solid var(--border); border-radius: 4px; background: color-mix(in srgb, var(--vscode-foreground) 4%, transparent); font-family: var(--vscode-editor-font-family, var(--vscode-font-family)); }
  :is(button, [tabindex="-1"]):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  [hidden] { display: none !important; }
  [dir="auto"] { unicode-bidi: plaintext; }
  @media (max-width: 375px) { #compact-mic-main { padding-inline: var(--space-2); } .compact-header, .compact-section { padding-inline: var(--space-2); } .deep-links > button { flex-basis: 100%; } }
  @media (forced-colors: active) { button, .compact-header, .compact-section { border-color: ButtonText; } h1::before { background: CanvasText; } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
`;
