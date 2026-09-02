export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; id?: string; text?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.id) node.id = options.id;
  if (options.text !== undefined) node.textContent = options.text;
  return node;
}

export function labelledButton(label: string, action: string, className = 'button secondary'): HTMLButtonElement {
  const button = element('button', { className, text: label });
  button.type = 'button';
  button.dataset.action = action;
  return button;
}

export function sectionCard(title: string, description?: string): HTMLElement {
  const section = element('section', { className: 'card' });
  section.append(element('h2', { text: title }));
  if (description) section.append(element('p', { className: 'muted', text: description }));
  return section;
}

export function mixedText(value: string, className?: string): HTMLElement {
  const text = element('bdi', { className, text: value });
  text.dir = 'auto';
  return text;
}
