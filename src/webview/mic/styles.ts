export const MIC_VIEW_STYLES = `
  :root {
    color-scheme: light dark;
    --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
    --border: var(--vscode-widget-border, var(--vscode-panel-border));
    --surface: var(--vscode-sideBar-background);
    --raised: var(--vscode-editorWidget-background, var(--surface));
    --muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
    --focus: var(--vscode-focusBorder, var(--vscode-contrastActiveBorder));
    --danger: var(--vscode-errorForeground, var(--vscode-foreground));
  }
  * { box-sizing: border-box; }
  html, body { min-width: 0; margin: 0; overflow-x: hidden; color: var(--vscode-foreground); background: var(--surface); font: var(--vscode-font-size, 13px)/1.5 var(--vscode-font-family); }
  #compact-mic-main { display: grid; gap: var(--space-3); min-width: 0; padding: var(--space-3); }
  .compact-header, .compact-section { min-width: 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: 4px; background: var(--raised); }
  .title-row, .deep-links { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-2); }
  .title-row { justify-content: space-between; }
  h1 { margin: 0; font-size: 1.25rem; line-height: 1.25; }
  h2 { margin-block: 0 var(--space-2); font-size: 1rem; }
  p { margin-block: var(--space-1); overflow-wrap: anywhere; }
  .provider-status, .muted, .shortcut { color: var(--muted); }
  button { min-width: 44px; min-height: 44px; max-width: 100%; padding: var(--space-2) var(--space-3); border: 1px solid var(--vscode-button-border, transparent); border-radius: 3px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.7; cursor: not-allowed; }
  .secondary { color: var(--vscode-foreground); background: var(--vscode-button-secondaryBackground, transparent); border-color: var(--border); }
  .auto-kill { color: var(--danger); background: transparent; border-color: var(--danger); font-weight: 700; }
  .mic-btn { width: 100%; font-weight: 700; }
  .launcher-section > #open-control-center { width: 100%; }
  .deep-links { margin-block-start: var(--space-2); }
  .deep-links > button { flex: 1 1 8rem; }
  kbd { padding: 2px 6px; border: 1px solid var(--border); border-radius: 2px; font-family: var(--vscode-editor-font-family, var(--vscode-font-family)); }
  :is(button, [tabindex="-1"]):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
  [hidden] { display: none !important; }
  [dir="auto"] { unicode-bidi: plaintext; }
  @media (max-width: 375px) { #compact-mic-main { padding-inline: var(--space-2); } .compact-header, .compact-section { padding-inline: var(--space-2); } .deep-links > button { flex-basis: 100%; } }
  @media (forced-colors: active) { button, .compact-header, .compact-section { border-color: ButtonText; } }
  @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation: none !important; transition: none !important; scroll-behavior: auto !important; } }
`;
