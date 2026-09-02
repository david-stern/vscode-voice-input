import type {
  ControlCenterCommandRow,
  ControlCenterHostMessage,
} from '../contracts';
import { element, labelledButton, mixedText, sectionCard } from '../dom';
import {
  COMMAND_CATEGORY_FILTERS,
  parseCommandFilterState,
} from '../filters';
import type { ControlCenterStrings } from '../i18n';

export function renderCommandsRoute(
  container: HTMLElement,
  snapshot: Extract<ControlCenterHostMessage, { type: 'stateSnapshot' }>,
  rows: readonly ControlCenterCommandRow[],
  strings: ControlCenterStrings,
  customPage?: Extract<ControlCenterHostMessage, { type: 'customCommandPageState' }>,
  customDetails?: Extract<ControlCenterHostMessage, { type: 'customCommandDetails' }>,
): void {
  const page = snapshot.state.commandPage;
  if (!page) {
    container.replaceChildren(sectionCard(strings.noResults));
    return;
  }
  const filterState = parseCommandFilterState(snapshot.state.filter);
  const filters = element('section', { className: 'card filters' });
  const searchLabel = element('label', { text: strings.searchCommands });
  searchLabel.htmlFor = 'command-search';
  const search = element('input', { id: 'command-search' });
  search.type = 'search';
  search.maxLength = 180;
  search.value = filterState.query;
  const chips = element('div', { className: 'filter-chips' });
  strings.categories.forEach((category, index) => {
    const chip = labelledButton(category, 'category-filter', 'filter-chip');
    chip.dataset.category = COMMAND_CATEGORY_FILTERS[index];
    chip.setAttribute('aria-pressed', String(filterState.category === chip.dataset.category));
    chips.append(chip);
  });
  const enabled = checkboxFilter('enabled-filter', strings.enabledOnly, 'enabledOnly', filterState.enabledOnly);
  const changed = checkboxFilter('changed-filter', strings.changedOnly, 'changedOnly', filterState.changedOnly);
  const clear = labelledButton(strings.clearFilters, 'clear-filters', 'button secondary');
  filters.append(searchLabel, search, chips, enabled, changed, clear);

  const results = element('section', { className: 'card command-results' });
  const resultsHeading = element('h2', { id: 'commands-results-heading', text: strings.routes.commands.title });
  resultsHeading.tabIndex = -1;
  const live = element('p', {
    className: 'muted',
    text: `${page.filteredCount} · ${page.pageIndex}/${Math.max(1, Math.ceil(page.filteredCount / 25))}`,
  });
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  results.append(resultsHeading, live);
  if (rows.length === 0) {
    const empty = element('h3', { id: 'commands-empty-heading', text: strings.noResults });
    empty.tabIndex = -1;
    results.append(empty);
  } else {
    results.append(commandTable(rows, page.filteredCount, strings));
  }
  results.append(pagination(page.pageIndex, page.filteredCount, strings));

  const custom = sectionCard(strings.customCommands, strings.customCommandsHelp);
  const customHeading = custom.querySelector('h2');
  if (customHeading) customHeading.id = 'custom-management-heading';
  const form = customCommandForm(customDetails, strings);
  const customList = element('div', { className: 'resource-list' });
  if (!customPage) customList.append(element('p', { className: 'muted', text: strings.managementLoading }));
  else if (customPage.items.length === 0) {
    customList.append(element('p', { className: 'muted', text: strings.customCommandsEmpty }));
  } else {
    for (const command of customPage.items) {
      const card = element('article', { className: 'resource-card' });
      card.dataset.customCommandId = command.id;
      const title = element('h3', { text: command.label });
      title.dir = 'auto';
      const description = element('p', { className: 'muted', text: command.description });
      description.dir = 'auto';
      const facts = element('p', { className: 'resource-flags' });
      facts.append(
        element('span', { className: 'badge', text: command.enabled ? strings.enabled : strings.disabled }),
        element('span', { className: 'badge', text: command.agentEnabled
          ? strings.agentAvailable : strings.agentPrivate }),
      );
      const target = mixedText(command.targetId, 'command-id');
      const actions = element('div', { className: 'button-row' });
      const toggle = labelledButton(
        command.enabled ? strings.disable : strings.enable,
        'toggle-custom-command', 'button secondary',
      );
      toggle.dataset.enabled = String(!command.enabled);
      actions.append(
        toggle,
        labelledButton(strings.edit, 'edit-custom-command', 'button secondary'),
        labelledButton(strings.deleteAction, 'delete-custom-command', 'button danger'),
      );
      card.append(title, description, facts, target, actions);
      customList.append(card);
    }
  }
  custom.append(form, element('p', {
    className: 'muted', text: strings.customNativeFlow,
  }), customList);
  if (customPage) custom.append(customPagination(customPage, strings));
  const pending = snapshot.state.pendingReview
    ? pendingReviewCard(snapshot.state.pendingReview.kind, snapshot.state.pendingReview.displayLabel, strings)
    : undefined;
  container.replaceChildren(...(pending ? [pending] : []), filters, results, custom);
}

function commandTable(
  rows: readonly ControlCenterCommandRow[],
  filteredCount: number,
  strings: ControlCenterStrings,
): HTMLTableElement {
  const table = element('table', { className: 'command-table' });
  table.setAttribute('aria-rowcount', String(filteredCount));
  const head = element('thead');
  const headingRow = element('tr');
  for (const label of [strings.enabled, strings.routes.commands.title, strings.edit]) {
    headingRow.append(element('th', { text: label }));
  }
  head.append(headingRow);
  const body = element('tbody');
  for (const row of rows) {
    const tableRow = element('tr');
    tableRow.dataset.commandId = row.commandId;
    tableRow.id = `command-row-${row.commandId}`;
    const enabledCell = element('td');
    const toggle = element('input');
    toggle.type = 'checkbox';
    toggle.checked = row.enabled;
    toggle.dataset.action = 'toggle-command';
    toggle.setAttribute('aria-label', `${strings.enabled}: ${row.localizedLabel}`);
    enabledCell.append(toggle);
    const detailsCell = element('td');
    detailsCell.append(
      element('strong', { text: row.localizedLabel }),
      mixedText(row.primaryPhrase, 'command-phrase'),
      mixedText(row.slotShortcutSummary, 'command-summary'),
      mixedText(row.commandId, 'command-id'),
    );
    if (row.availability !== 'available') {
      detailsCell.append(element('span', { className: 'badge', text: strings.unavailable }));
    }
    const actionCell = element('td');
    const edit = labelledButton(strings.edit, 'edit-command', 'button secondary');
    edit.dataset.commandId = row.commandId;
    actionCell.append(edit);
    tableRow.append(enabledCell, detailsCell, actionCell);
    body.append(tableRow);
  }
  table.append(head, body);
  return table;
}

function pagination(page: number, filteredCount: number, strings: ControlCenterStrings): HTMLElement {
  const pages = Math.max(1, Math.ceil(filteredCount / 25));
  const controls = element('nav', { className: 'pagination' });
  controls.setAttribute('aria-label', strings.routes.commands.title);
  const previous = labelledButton(strings.previous, 'previous-page', 'button secondary');
  previous.disabled = page <= 1;
  const current = element('span', { text: `${page} / ${pages}` });
  const next = labelledButton(strings.next, 'next-page', 'button secondary');
  next.disabled = page >= pages;
  controls.append(previous, current, next);
  return controls;
}

function checkboxFilter(
  id: string,
  labelText: string,
  field: 'enabledOnly' | 'changedOnly',
  checked: boolean,
): HTMLLabelElement {
  const label = element('label', { className: 'check-filter' });
  const checkbox = element('input', { id });
  checkbox.type = 'checkbox';
  checkbox.dataset.action = 'boolean-filter';
  checkbox.dataset.filterField = field;
  checkbox.checked = checked;
  label.append(checkbox, element('span', { text: labelText }));
  return label;
}

function pendingReviewCard(
  kind: 'builtin' | 'custom',
  label: string,
  strings: ControlCenterStrings,
): HTMLElement {
  const pending = sectionCard(strings.pendingReview, label);
  pending.id = kind === 'custom' ? 'pending-custom-review' : 'pending-builtin-review';
  pending.tabIndex = -1;
  const review = labelledButton(strings.review, 'preview-pending-action');
  review.id = 'pending-review';
  pending.append(review);
  return pending;
}

function customCommandForm(
  details: Extract<ControlCenterHostMessage, { type: 'customCommandDetails' }> | undefined,
  strings: ControlCenterStrings,
): HTMLFormElement {
  const form = element('form', { className: 'custom-command-form management-form' });
  form.dataset.action = 'custom-command-form';
  if (details) form.dataset.customCommandId = details.id;
  const heading = element('h3', {
    id: 'custom-command-form-heading',
    text: details ? strings.customEditHeading : strings.addCustom,
  });
  heading.tabIndex = -1;
  form.append(heading);
  const summary = element('p', {
    id: 'custom-command-error', className: 'form-error', text: strings.customFormError,
  });
  summary.hidden = true;
  summary.tabIndex = -1;
  form.append(
    summary,
    textField('custom-command-label', strings.customName, details?.label ?? '', 80),
    textField('custom-command-description', strings.customDescription, details?.description ?? '', 240),
  );

  const phrasesLabel = element('label', { className: 'field' });
  phrasesLabel.htmlFor = 'custom-command-phrases';
  phrasesLabel.append(element('span', { text: strings.customPhrases }));
  const phrases = element('textarea', { id: 'custom-command-phrases' });
  phrases.maxLength = 1_219;
  phrases.value = details?.phrases.join('\n') ?? '';
  phrases.dir = 'auto';
  phrases.setAttribute('aria-describedby', 'custom-command-phrases-help custom-command-error');
  phrasesLabel.append(phrases, element('span', {
    id: 'custom-command-phrases-help', className: 'muted', text: strings.phrasesRequired,
  }));
  form.append(phrasesLabel);

  const kindLabel = element('label', { className: 'field' });
  kindLabel.htmlFor = 'custom-command-kind';
  kindLabel.append(element('span', { text: strings.customKind }));
  const kind = element('select', { id: 'custom-command-kind' });
  kind.append(
    option('command', strings.customKindCommand, details?.kind !== 'language-model-tool'),
    option('language-model-tool', strings.customKindTool, details?.kind === 'language-model-tool'),
  );
  kindLabel.append(kind);
  form.append(
    kindLabel,
    textField('custom-command-target', strings.customTarget, details?.targetId ?? '', 256),
    checkField('custom-command-enabled', strings.customEnabled, details?.enabled ?? true),
    checkField('custom-command-agent-enabled', strings.customAgentEnabled, details?.agentEnabled ?? false),
  );
  const actions = element('div', { className: 'button-row' });
  const save = labelledButton(details ? strings.customSave : strings.addCustom, 'save-custom-command');
  save.type = 'submit';
  actions.append(save);
  if (details) actions.append(labelledButton(
    strings.customCancelEdit,
    'cancel-custom-command-edit',
    'button secondary',
  ));
  form.append(actions);
  return form;
}

function textField(id: string, labelText: string, value: string, maxLength: number): HTMLLabelElement {
  const label = element('label', { className: 'field' });
  label.htmlFor = id;
  label.append(element('span', { text: labelText }));
  const input = element('input', { id });
  input.type = 'text';
  input.maxLength = maxLength;
  input.value = value;
  input.dir = 'auto';
  input.setAttribute('aria-describedby', 'custom-command-error');
  label.append(input);
  return label;
}

function checkField(id: string, labelText: string, checked: boolean): HTMLLabelElement {
  const label = element('label', { className: 'check-filter' });
  const input = element('input', { id });
  input.type = 'checkbox';
  input.checked = checked;
  label.append(input, element('span', { text: labelText }));
  return label;
}

function option(value: string, label: string, selected: boolean): HTMLOptionElement {
  const item = element('option', { text: label });
  item.value = value;
  item.selected = selected;
  return item;
}

function customPagination(
  page: Extract<ControlCenterHostMessage, { type: 'customCommandPageState' }>,
  strings: ControlCenterStrings,
): HTMLElement {
  const pages = Math.max(1, Math.ceil(page.totalCount / page.pageSize));
  const controls = element('nav', { className: 'pagination' });
  controls.setAttribute('aria-label', strings.customCommands);
  const previous = labelledButton(strings.previous, 'management-page', 'button secondary');
  previous.dataset.managementTarget = 'custom-commands';
  previous.dataset.page = String(page.pageIndex - 1);
  previous.disabled = page.pageIndex <= 1;
  const next = labelledButton(strings.next, 'management-page', 'button secondary');
  next.dataset.managementTarget = 'custom-commands';
  next.dataset.page = String(page.pageIndex + 1);
  next.disabled = page.pageIndex >= pages;
  controls.append(previous, element('span', { text: `${page.pageIndex} / ${pages}` }), next);
  return controls;
}
