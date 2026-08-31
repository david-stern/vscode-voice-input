import type { SettingsStrings } from './i18n';

export interface SelectOption {
  value: string;
  label: string;
}

export type FocusedControlSyncAction = 'apply' | 'preserve' | 'defer' | 'clear';

/** Pure reducer shared by DOM updates and deterministic focus/rejection tests. */
export function focusedControlSyncAction(
  focused: boolean,
  authoritative: boolean,
  differs: boolean,
): FocusedControlSyncAction {
  if (!focused) return differs ? 'apply' : 'clear';
  if (!authoritative) return 'preserve';
  return differs ? 'defer' : 'clear';
}

export function byId<T extends HTMLElement>(id: string): T | undefined {
  return document.getElementById(id) as T | null ?? undefined;
}

export function setText(id: string, value: string): void {
  const node = byId(id);
  if (node && node.textContent !== value) node.textContent = value;
}

export function setInputValue(id: string, value: string, authoritative = false): void {
  const input = byId<HTMLInputElement | HTMLSelectElement>(id);
  if (!input) return;
  applyFocusedControlSync(
    input,
    authoritative,
    input.value !== value,
    () => { input.value = value; },
  );
}

export function setChecked(id: string, checked: boolean, authoritative = false): void {
  const input = byId<HTMLInputElement>(id);
  if (!input) return;
  applyFocusedControlSync(
    input,
    authoritative,
    input.checked !== checked,
    () => { input.checked = checked; },
  );
}

export function setDisabled(id: string, disabled: boolean): void {
  const control = byId<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(id);
  if (control) control.disabled = disabled;
}

export function setHidden(element: HTMLElement | null | undefined, hidden: boolean): void {
  if (element) element.hidden = hidden;
}

export function syncOptions(
  id: string,
  options: readonly SelectOption[],
  selected: string,
  authoritative = false,
): void {
  const select = byId<HTMLSelectElement>(id);
  if (!select) return;
  const signature = options.map(({ value, label }) => `${value}\u0000${label}`).join('\u0001');
  const differs = select.dataset.signature !== signature || select.value !== selected;
  applyFocusedControlSync(select, authoritative, differs, () => {
    if (select.dataset.signature !== signature) {
      const fragment = document.createDocumentFragment();
      for (const option of options) {
        const node = document.createElement('option');
        node.value = option.value;
        node.textContent = option.label;
        fragment.append(node);
      }
      select.replaceChildren(fragment);
      select.dataset.signature = signature;
    }
    if (select.value !== selected) select.value = selected;
  });
}

export function hasDeferredControlUpdate(control: HTMLInputElement | HTMLSelectElement): boolean {
  return control.dataset.settingsDeferred === 'true';
}

export function clearDeferredControlUpdate(control: HTMLInputElement | HTMLSelectElement): void {
  delete control.dataset.settingsDeferred;
}

export function includeSelected(
  options: readonly SelectOption[],
  selected: string,
): SelectOption[] {
  return options.some((option) => option.value === selected)
    ? [...options]
    : [{ value: selected, label: selected }, ...options];
}

export function applyTranslations(root: HTMLElement, strings: SettingsStrings): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset.i18n as keyof SettingsStrings;
    const translation = strings[key];
    if (translation !== undefined && element.textContent !== translation) {
      element.textContent = translation;
    }
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach((element) => {
    const key = element.dataset.i18nPlaceholder as keyof SettingsStrings;
    const translation = strings[key];
    if (translation !== undefined) element.placeholder = translation;
  });
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  return element;
}

export function createButton(label: string, className?: string): HTMLButtonElement {
  const button = createElement('button', className);
  button.type = 'button';
  button.textContent = label;
  return button;
}

function applyFocusedControlSync(
  control: HTMLInputElement | HTMLSelectElement,
  authoritative: boolean,
  differs: boolean,
  apply: () => void,
): void {
  const action = focusedControlSyncAction(
    document.activeElement === control,
    authoritative,
    differs,
  );
  if (action === 'apply') apply();
  if (action === 'defer') control.dataset.settingsDeferred = 'true';
  if (action === 'apply' || action === 'clear') clearDeferredControlUpdate(control);
}
