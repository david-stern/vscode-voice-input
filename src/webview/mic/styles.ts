export const MIC_VIEW_STYLES = `
  :root {
    color-scheme: light dark;
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
    --radius: 4px;
    --border: var(--vscode-widget-border, var(--vscode-panel-border));
    --surface: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    --surface-raised: var(--vscode-editor-background, var(--vscode-sideBar-background));
    --surface-soft: var(--vscode-input-background, var(--vscode-sideBar-background));
    --accent: var(--vscode-button-background);
    --accent-fg: var(--vscode-button-foreground);
    --accent-hover: var(--vscode-button-hoverBackground);
    --muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
    --focus: var(--vscode-focusBorder, var(--vscode-contrastActiveBorder));
    --danger: var(--vscode-errorForeground, var(--vscode-foreground));
    --danger-surface: var(--vscode-inputValidation-errorBackground, var(--surface-soft));
  }
  * { box-sizing: border-box; }
  html, body {
    min-width: 0;
    margin: 0;
    padding: 0;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    font: var(--vscode-font-size, 13px)/1.55 var(--vscode-font-family);
  }
  button, input, select { font: inherit; }
  #root, #conversation-main { min-width: 0; }
  #conversation-main {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-3);
  }
  .conversation-header { padding-block-end: var(--space-3); border-block-end: 1px solid var(--border); }
  .conversation-header h1 { margin: 0; font-size: 1.35rem; line-height: 1.2; letter-spacing: -0.02em; }
  .conversation-header p { margin-block: var(--space-1) 0; color: var(--muted); }

  .card, .section {
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .mic-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    padding-block: var(--space-5);
  }
  .mic-btn {
    display: grid;
    place-items: center;
    grid-template-rows: 36px auto;
    gap: var(--space-1);
    width: min(128px, 100%);
    min-height: 88px;
    padding: var(--space-2);
    border: 2px solid transparent;
    border-radius: 999px;
    color: var(--accent-fg);
    background: var(--accent);
    cursor: pointer;
    touch-action: manipulation;
    user-select: none;
    transition: background-color 150ms ease, border-color 150ms ease;
  }
  .mic-btn svg { width: 36px; height: 36px; }
  .mic-action-label {
    max-width: 100%;
    font-size: 0.92rem;
    font-weight: 600;
    line-height: 1.15;
    text-align: center;
    overflow-wrap: anywhere;
  }
  .mic-btn:hover { background: var(--accent-hover); }
  .mic-btn:active { border-color: currentColor; }
  .mic-btn.recording { color: var(--danger); background: var(--danger-surface); border-color: var(--danger); }
  .status { display: flex; align-items: center; gap: var(--space-2); min-height: 24px; font-weight: 600; }
  .status-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); }
  .status-dot.on { background: var(--danger); animation: status-blink 1.2s ease-in-out infinite; }
  @keyframes status-blink { 50% { opacity: 0.35; } }
  .hint { max-width: 58ch; color: var(--muted); text-align: center; }
  .hint-key, .kbd {
    display: inline-block;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 2px;
    color: var(--vscode-textPreformat-foreground);
    background: var(--vscode-textCodeBlock-background);
    font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
    font-weight: 600;
  }

  .section-head, .assistant-row, .actions-row, .entry-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .section-head { margin-block-end: var(--space-2); }
  .section-head h2 { display: flex; align-items: center; gap: var(--space-2); margin: 0; font-size: 0.92rem; font-weight: 600; }
  .count, .badge {
    display: inline-flex;
    align-items: center;
    min-height: 24px;
    padding-inline: var(--space-2);
    border-radius: 999px;
    color: var(--vscode-badge-foreground);
    background: var(--vscode-badge-background);
    font-size: 0.86rem;
  }

  .history-list { display: flex; flex-direction: column; gap: var(--space-2); max-height: 320px; overflow-y: auto; }
  .empty { padding: var(--space-4) var(--space-2); color: var(--muted); text-align: center; }
  .entry { display: grid; gap: var(--space-2); min-width: 0; padding: var(--space-2); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-soft); }
  .entry:hover { border-color: var(--focus); }
  .entry-text { line-height: 1.5; white-space: normal; overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .entry-meta { justify-content: flex-start; color: var(--muted); }
  .ts { margin-inline-start: auto; font-variant-numeric: tabular-nums; }

  button {
    min-height: 44px;
    max-width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    color: var(--accent-fg);
    background: var(--accent);
    cursor: pointer;
    touch-action: manipulation;
  }
  button:hover:not(:disabled) { background: var(--accent-hover); }
  button:disabled { opacity: 0.5; cursor: default; }
  .history-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    flex: none;
    min-width: 44px;
    min-height: 44px;
    padding: 8px 10px;
    color: var(--vscode-foreground);
    background: transparent;
    border-color: transparent;
  }
  .history-action svg { flex: none; }
  .history-action-label { overflow-wrap: anywhere; }
  .history-action:hover:not(:disabled) { background: var(--surface-raised); border-color: var(--border); }
  .history-action.danger:hover:not(:disabled) { color: var(--danger); background: var(--danger-surface); border-color: var(--danger); }
  .history-action.flash { color: var(--accent-fg); background: var(--accent); }
  .link-btn, .btn-ghost, .toggle-btn {
    color: var(--vscode-textLink-foreground, var(--vscode-foreground));
    background: transparent;
    border-color: var(--border);
  }
  .link-btn:hover:not(:disabled), .btn-ghost:hover:not(:disabled), .toggle-btn:hover:not(:disabled) { color: var(--vscode-textLink-activeForeground, var(--vscode-foreground)); background: var(--surface-soft); }
  .link-btn.danger { color: var(--danger); }
  .toggle-btn { border-radius: 999px; }
  .toggle-btn.on { color: var(--accent-fg); background: var(--accent); }
  :is(button, select, input, [tabindex="-1"]):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .assistant-section { display: grid; gap: var(--space-3); }
  .assistant-section .section-head { margin-block-end: 0; }
  .assistant-status, .assistant-feedback, .subtle-status, .confidence-label, .pending-send p { margin: 0; }
  .assistant-status, .subtle-status, .confidence-label { color: var(--muted); }
  .assistant-feedback { padding: var(--space-2); border-inline-start: 3px solid var(--focus); background: var(--surface-soft); overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .assistant-field { display: grid; gap: var(--space-1); min-width: 0; }
  .assistant-field > span, .field-label { font-weight: 600; }
  .assistant-field input:not([type="range"]), .assistant-field select {
    width: 100%;
    min-width: 0;
    min-height: 40px;
    padding: 7px 9px;
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 2px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
  }
  .assistant-field input[type="range"] { width: 100%; min-height: 44px; accent-color: var(--vscode-progressBar-background); }
  .check-row { display: flex; align-items: center; gap: var(--space-2); min-height: 44px; cursor: pointer; }
  .check-row input { width: 18px; height: 18px; accent-color: var(--vscode-checkbox-background); }
  .assistant-subsection, .assistant-target, .pending-send {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-soft);
  }
  .subtle-status.error { color: var(--danger); }
  .assistant-target progress { width: 100%; height: 8px; accent-color: var(--vscode-progressBar-background); }
  .assistant-confidence { display: grid; gap: var(--space-2); }
  .pending-send { border-color: var(--vscode-inputValidation-warningBorder, var(--border)); background: var(--vscode-inputValidation-warningBackground, var(--surface-soft)); }
  .pending-send blockquote { max-height: 140px; margin: 0; padding-inline-start: var(--space-2); border-inline-start: 3px solid var(--border); overflow-y: auto; overflow-wrap: anywhere; unicode-bidi: plaintext; white-space: pre-wrap; }
  .pending-action-details { display: grid; gap: var(--space-2); margin: 0; }
  .pending-action-details div { display: grid; gap: var(--space-1); min-width: 0; }
  .pending-action-details dt { font-weight: 600; }
  .pending-action-details dd { margin: 0; padding: var(--space-2); border: 1px solid var(--border); border-radius: 2px; background: var(--vscode-textCodeBlock-background, var(--surface-raised)); overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .assistant-disclosure { padding-inline-start: var(--space-2); border-inline-start: 3px solid var(--border); color: var(--muted); }
  .assistant-disclosure p { margin-block: 0 var(--space-2); }
  .meta-loading { display: inline-block; margin-inline-start: var(--space-2); animation: spin 1s linear infinite; }
  .meta-error { color: var(--danger); }
  @keyframes spin { to { transform: rotate(360deg); } }

  [hidden] { display: none !important; }
  [dir="ltr"] { text-align: left; }
  [dir="rtl"] .ts { margin-inline-start: 0; margin-inline-end: auto; }
  @media (max-width: 375px) {
    #conversation-main { padding-inline: var(--space-2); }
    .card, .section { padding-inline: var(--space-2); }
    .section-head, .entry-meta { align-items: flex-start; }
    .ts { flex-basis: 100%; margin-inline: 0; }
    .actions-row > button, .assistant-row > button { flex: 1 1 100%; }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; scroll-behavior: auto !important; transition: none !important; }
  }
`;
