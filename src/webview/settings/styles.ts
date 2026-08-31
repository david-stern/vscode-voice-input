export const SETTINGS_VIEW_STYLES = `
  :root {
    color-scheme: light dark;
    --border: var(--vscode-settings-headerBorder, var(--vscode-panel-border));
    --surface: var(--vscode-editorWidget-background, var(--vscode-sideBar-background));
    --surface-raised: var(--vscode-editor-background, var(--vscode-sideBar-background));
    --surface-soft: var(--vscode-input-background, var(--vscode-sideBar-background));
    --text: var(--vscode-foreground);
    --muted: var(--vscode-descriptionForeground, var(--vscode-foreground));
    --focus: var(--vscode-focusBorder, var(--vscode-contrastActiveBorder));
    --positive: var(--vscode-testing-iconPassed, var(--vscode-foreground));
    --warning: var(--vscode-notificationsWarningIcon-foreground, var(--vscode-foreground));
    --danger: var(--vscode-errorForeground, var(--vscode-foreground));
    --radius: 4px;
    --space-1: 4px;
    --space-2: 8px;
    --space-3: 12px;
    --space-4: 16px;
    --space-5: 24px;
  }
  * { box-sizing: border-box; }
  html, body { min-width: 0; margin: 0; padding: 0; }
  body {
    color: var(--text);
    background: var(--vscode-sideBar-background);
    font: var(--vscode-font-size, 13px)/1.55 var(--vscode-font-family);
  }
  button, input, select { font: inherit; }
  p { max-width: 75ch; }
  #root { min-width: 0; padding: var(--space-4); }
  [hidden] { display: none !important; }
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
  .skip-link {
    position: fixed;
    inset-block-start: var(--space-1);
    inset-inline-start: var(--space-1);
    z-index: 20;
    max-width: calc(100% - var(--space-2));
    min-height: 44px;
    padding: 10px 12px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    transform: translateY(-160%);
  }
  .skip-link:focus { transform: translateY(0); }
  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-4);
    padding-block-end: var(--space-4);
    border-block-end: 1px solid var(--border);
  }
  .page-header h1 { margin: 0; font-size: clamp(1.35rem, 2.5vw, 1.8rem); line-height: 1.2; letter-spacing: -0.02em; }
  .page-header p, .route-heading p, .section-heading p { margin-block: var(--space-1) 0; color: var(--muted); }
  .eyebrow {
    margin: 0 !important;
    color: var(--muted);
    font-size: 0.86rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .live-status { min-height: 1.55em; max-width: 34ch; color: var(--vscode-notificationsInfoIcon-foreground, var(--text)); }
  .live-status.success { color: var(--positive); }
  .live-status.warning { color: var(--warning); }
  .live-status.error { color: var(--danger); }

  .app-layout { display: grid; grid-template-columns: minmax(156px, 0.28fr) minmax(0, 1fr); gap: var(--space-5); padding-block-start: var(--space-4); }
  .route-nav { min-width: 0; }
  .route-nav h2 { margin-block: 0 var(--space-2); font-size: 0.86rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
  .route-list { display: grid; gap: var(--space-1); }
  .route-link {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 4px;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    width: 100%;
    padding-block: var(--space-2);
    padding-inline: var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius);
    color: var(--text);
    background: transparent;
    text-align: start;
    cursor: pointer;
    touch-action: manipulation;
  }
  .route-link:hover { background: var(--vscode-list-hoverBackground); }
  .route-link[aria-current="page"] { color: var(--vscode-list-activeSelectionForeground, var(--text)); background: var(--vscode-list-activeSelectionBackground, var(--surface-soft)); }
  .route-marker { width: 4px; height: 24px; background: transparent; }
  .route-link[aria-current="page"] .route-marker { background: currentColor; }

  main { min-width: 0; }
  .route-panel { display: grid; gap: var(--space-4); min-width: 0; max-width: 960px; }
  .route-heading { padding-block-end: var(--space-2); border-block-end: 1px solid var(--border); }
  .route-heading h2 { margin-block: var(--space-1) 0; font-size: 1.35rem; line-height: 1.25; letter-spacing: -0.01em; }
  .section-heading h3, .card-heading h3, .surface > h3, .setup-stage h3 { margin: 0; font-size: 1rem; }
  .section-heading { margin-block-end: var(--space-3); }
  .surface, .provider-card, .trust-card, .flow-list article, .setup-stage, .readiness-card, .callout {
    min-width: 0;
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  .provider-card, .agent-card, .surface { display: grid; gap: var(--space-3); }
  .card-heading, .readiness-footer, .status-row, .consent-row, .inline-actions, .progress-copy {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .service-pipeline { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
  .service-pipeline li { display: grid; gap: var(--space-1); min-width: 0; padding: var(--space-3); border-block-start: 3px solid var(--vscode-progressBar-background, var(--border)); background: var(--surface-soft); }
  .service-pipeline span { color: var(--muted); }

  .setup-progress { display: grid; gap: var(--space-2); }
  .setup-progress progress { width: 100%; height: 8px; accent-color: var(--vscode-progressBar-background); }
  .setup-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
  .setup-step {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    min-height: 52px;
    width: 100%;
    padding: var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--text);
    background: var(--surface-soft);
    text-align: start;
    cursor: pointer;
  }
  .setup-step[aria-current="step"] { border-color: var(--focus); background: var(--vscode-list-activeSelectionBackground, var(--surface-soft)); }
  .setup-step.complete .step-number { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .step-number { display: grid; place-items: center; width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 50%; }
  .step-state { grid-column: 2; color: var(--muted); font-size: 0.86rem; }
  .setup-stage { display: grid; gap: var(--space-2); }
  .setup-stage p { margin: 0; }
  .setup-actions { display: flex; justify-content: space-between; gap: var(--space-2); }

  .readiness-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); }
  .readiness-card { display: flex; flex-direction: column; justify-content: space-between; gap: var(--space-3); }
  .readiness-card h4 { margin: 0; font-size: 1rem; }
  .readiness-card p { margin-block: var(--space-1) 0; color: var(--muted); }
  .status-badge { display: inline-flex; align-items: center; min-height: 28px; padding-inline: var(--space-2); border: 1px solid var(--border); border-radius: 999px; font-size: 0.86rem; }
  .status-badge.ready { color: var(--positive); }
  .status-badge.attention { color: var(--warning); }
  .status-badge.loading { color: var(--vscode-progressBar-background, var(--text)); }
  .status-badge.unavailable { color: var(--danger); }

  .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
  .field { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
  label, .field-label { font-weight: 600; }
  input[type="text"], select {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    padding-block: 7px;
    padding-inline: 9px;
    border: 1px solid var(--vscode-input-border, var(--border));
    border-radius: 2px;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
  }
  input[type="range"] { width: 100%; min-height: 44px; accent-color: var(--vscode-progressBar-background); }
  input[type="checkbox"] { flex: none; width: 18px; height: 18px; accent-color: var(--vscode-checkbox-background); }
  .check-row { display: flex; align-items: center; gap: var(--space-2); min-height: 44px; font-weight: 400; cursor: pointer; }
  input:disabled, select:disabled, button:disabled { opacity: 0.5; cursor: default; }
  .help, .inline-status, .field-error { margin: 0; color: var(--muted); }
  .inline-status { min-height: 1.55em; }
  .inline-status.error, .field-error { color: var(--danger); }

  button {
    min-height: 44px;
    max-width: 100%;
    padding-block: 8px;
    padding-inline: 14px;
    border: 1px solid var(--vscode-button-border, transparent);
    border-radius: 2px;
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    line-height: 1.35;
    cursor: pointer;
    white-space: normal;
    touch-action: manipulation;
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button.secondary { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  button.danger { color: var(--danger); background: transparent; border-color: var(--danger); }
  button.danger:hover:not(:disabled) { color: var(--vscode-button-foreground); background: var(--vscode-inputValidation-errorBackground, var(--surface-soft)); }
  .link-button { min-height: 44px; padding-inline: var(--space-2); color: var(--vscode-textLink-foreground); background: transparent; border-color: transparent; }
  .link-button:hover:not(:disabled) { color: var(--vscode-textLink-activeForeground); background: transparent; text-decoration: underline; }
  .button-row { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  :is(button, input, select, [tabindex="-1"]):focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }

  .override { padding: var(--space-2); border-inline-start: 3px solid var(--warning); color: var(--text); background: var(--vscode-inputValidation-warningBackground, var(--surface-soft)); }
  .override dl, .identity-list { display: grid; gap: var(--space-2); margin: var(--space-2) 0 0; }
  .override dl div, .identity-list div { display: grid; grid-template-columns: minmax(112px, 0.35fr) minmax(0, 1fr); gap: var(--space-2); }
  .override dt, .identity-list dt { color: var(--muted); }
  .override dd, .identity-list dd { min-width: 0; margin: 0; overflow-wrap: anywhere; unicode-bidi: plaintext; }
  code.command-id, dd.command-id { display: block; max-width: 100%; padding: var(--space-1) var(--space-2); color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); font-family: var(--vscode-editor-font-family); overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .credential-status { margin: 0; font-weight: 600; }
  .credential-status.configured { color: var(--positive); }
  .credential-status.missing { color: var(--warning); }
  .flow-list, .mapping-list, .provider-list, .agent-list, .provider-privacy-list,
  .approval-history, .check-list { display: grid; gap: var(--space-2); }
  .flow-list p { margin-block: var(--space-1) 0; }
  .callout { border-inline-start: 3px solid var(--vscode-textBlockQuote-border, var(--border)); background: var(--vscode-textBlockQuote-background, var(--surface)); }
  .callout p, .callout h3 { margin: 0; }

  .mapping-card { display: grid; gap: var(--space-2); min-width: 0; padding: var(--space-3); border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-raised); }
  .mapping-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
  .mapping-heading h3 { min-width: 0; margin: 0; font-size: 1rem; overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .mapping-kind { flex: none; padding: 2px var(--space-2); border-radius: 999px; color: var(--vscode-badge-foreground); background: var(--vscode-badge-background); font-size: 0.86rem; }
  .mapping-description { margin: 0; color: var(--muted); overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .mapping-details { display: grid; gap: var(--space-1); margin: 0; }
  .mapping-details div { display: grid; grid-template-columns: minmax(88px, auto) minmax(0, 1fr); gap: var(--space-2); }
  .mapping-details dt { color: var(--muted); }
  .mapping-details dd { min-width: 0; margin: 0; overflow-wrap: anywhere; unicode-bidi: plaintext; }
  .mapping-flags { display: flex; flex-wrap: wrap; gap: var(--space-1); }
  .provider-card.selected { border-color: var(--focus); }
  .provider-facts { margin: 0; }
  .agent-card h3, .provider-privacy-card h3 { margin: 0; }
  .agent-description { margin-block-start: var(--space-1); }
  .provider-privacy-card, .approval-history-entry {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface-raised);
  }
  .approval-history-entry time { color: var(--muted); }

  .diagnostics-meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-2); margin: 0; }
  .diagnostics-meta div { min-width: 0; padding: var(--space-2); background: var(--surface-soft); }
  .diagnostics-meta dt { color: var(--muted); }
  .diagnostics-meta dd { margin: 0; overflow-wrap: anywhere; }
  .diagnostic-check { display: flex; justify-content: space-between; gap: var(--space-2); min-height: 44px; align-items: center; border-block-end: 1px solid var(--border); }
  .diagnostic-check:last-child { border-block-end: 0; }
  .diagnostic-check .ok { color: var(--positive); }
  .diagnostic-check .attention { color: var(--warning); }
  .diagnostic-check .unavailable { color: var(--danger); }

  [dir="ltr"], .command-id { text-align: left; }
  @media (max-width: 680px) {
    #root { padding: var(--space-3); }
    .page-header { align-items: flex-start; flex-direction: column; }
    .app-layout { grid-template-columns: minmax(0, 1fr); gap: var(--space-4); }
    .route-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .route-nav h2 { margin-block-end: var(--space-1); }
    .setup-steps, .readiness-grid, .form-grid { grid-template-columns: minmax(0, 1fr); }
    .service-pipeline { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 375px) {
    #root { padding-inline: var(--space-2); }
    .surface, .provider-card, .trust-card, .flow-list article, .setup-stage, .readiness-card, .callout { padding: var(--space-3); }
    .button-row > button, .status-row > button, .consent-row > button { flex: 1 1 100%; }
    .override dl div, .identity-list div, .mapping-details div { grid-template-columns: minmax(0, 1fr); }
  }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; }
  }
`;
