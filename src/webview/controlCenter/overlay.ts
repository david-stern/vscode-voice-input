import { element, labelledButton } from './dom';

export type ControlCenterOverlayKind =
  | 'command-details'
  | 'provider-details'
  | 'narrow-nav'
  | 'auto-explanation'
  | 'action-preview';

export interface OpenOverlayOptions {
  kind: ControlCenterOverlayKind;
  title: string;
  description?: string;
  trigger: HTMLElement;
  closeLabel: string;
  initialFocus?: 'heading' | 'close' | 'current-route';
  renderBody: (body: HTMLElement, footer: HTMLElement) => void;
}

/** One-overlay controller with deterministic cleanup, inert background, and focus return. */
export class OverlayController {
  private active: { trigger: HTMLElement; kind: ControlCenterOverlayKind } | undefined;
  private keydown: ((event: KeyboardEvent) => void) | undefined;
  private restoreAriaHidden: string | null = null;

  constructor(
    private readonly app: HTMLElement,
    private readonly root: HTMLElement,
    private readonly onUserClose: (reason: 'close' | 'escape') => void,
  ) {}

  get activeKind(): ControlCenterOverlayKind | undefined { return this.active?.kind; }

  open(options: OpenOverlayOptions): void {
    if (this.active) this.close(false);
    this.active = { trigger: options.trigger, kind: options.kind };
    this.restoreAriaHidden = this.app.getAttribute('aria-hidden');
    this.setBackgroundInert(true);

    const backdrop = element('div', { className: 'overlay-backdrop' });
    const dialog = element('section', { className: `overlay-dialog ${drawerKind(options.kind) ? 'drawer' : 'modal'}` });
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    const headingId = `overlay-title-${options.kind}`;
    dialog.setAttribute('aria-labelledby', headingId);
    const header = element('header', { className: 'overlay-header' });
    const heading = element('h2', { id: headingId, text: options.title });
    heading.tabIndex = -1;
    const close = labelledButton(options.closeLabel, 'close-overlay', 'button secondary overlay-close');
    header.append(heading, close);
    const body = element('div', { className: 'overlay-body' });
    if (options.description) {
      const description = element('p', { className: 'muted', text: options.description });
      description.id = `overlay-description-${options.kind}`;
      dialog.setAttribute('aria-describedby', description.id);
      body.append(description);
    }
    const footer = element('footer', { className: 'overlay-footer' });
    options.renderBody(body, footer);
    dialog.append(header, body, footer);
    backdrop.append(dialog);
    this.root.replaceChildren(backdrop);

    close.addEventListener('click', () => this.onUserClose('close'));
    this.keydown = (event) => this.handleKeydown(event, dialog);
    document.addEventListener('keydown', this.keydown);
    const initial = options.initialFocus === 'heading'
      ? heading
      : options.initialFocus === 'current-route'
        ? dialog.querySelector<HTMLElement>('[aria-current="page"]') ?? heading
        : close;
    initial.focus({ preventScroll: true });
  }

  close(returnFocus: boolean): void {
    const active = this.active;
    if (!active) return;
    if (this.keydown) document.removeEventListener('keydown', this.keydown);
    this.keydown = undefined;
    this.root.replaceChildren();
    this.setBackgroundInert(false);
    this.active = undefined;
    if (returnFocus) {
      const trigger = active.trigger as HTMLElement & { disabled?: boolean };
      const target = trigger.isConnected && !trigger.hidden && !trigger.disabled
        ? active.trigger
        : document.querySelector<HTMLElement>('main h1');
      target?.focus({ preventScroll: true });
    }
  }

  closeForNativePrompt(): void { this.close(false); }

  dispose(): void { this.close(false); }

  private handleKeydown(event: KeyboardEvent, dialog: HTMLElement): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.onUserClose('escape');
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>([
      'button:not([disabled])', 'input:not([disabled])', 'select:not([disabled])',
      'textarea:not([disabled])', 'a[href]', '[tabindex]:not([tabindex="-1"])',
    ].join(','))).filter((node) => !node.hidden);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private setBackgroundInert(inert: boolean): void {
    (this.app as HTMLElement & { inert: boolean }).inert = inert;
    if (inert) this.app.setAttribute('aria-hidden', 'true');
    else if (this.restoreAriaHidden === null) this.app.removeAttribute('aria-hidden');
    else this.app.setAttribute('aria-hidden', this.restoreAriaHidden);
    if (!inert) this.restoreAriaHidden = null;
  }
}

function drawerKind(kind: ControlCenterOverlayKind): boolean {
  return kind === 'command-details' || kind === 'provider-details' || kind === 'narrow-nav';
}
