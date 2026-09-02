import { definitions, slot } from './helpers';

export const WORKBENCH_COMMANDS = definitions('files-tabs-groups', [
  { suffix: 'file.new', en: 'new file', he: 'קובץ חדש', command: 'workbench.action.files.newUntitledFile', risk: 'confirmation-required' },
  { suffix: 'file.open', en: 'open file {file}', he: 'פתח קובץ {file}', command: 'api.editor.openWorkspaceFile', slot: slot('file', 'workspaceFile') },
  { suffix: 'file.save', en: 'save file', he: 'שמור קובץ', command: 'workbench.action.files.save', risk: 'confirmation-required' },
  { suffix: 'file.saveAll', en: 'save all', he: 'שמור הכול', command: 'workbench.action.files.saveAll', risk: 'confirmation-required' },
  { suffix: 'tab.close', en: 'close tab', he: 'סגור טאב', command: 'workbench.action.closeActiveEditor' },
  { suffix: 'tab.closeAll', en: 'close all tabs', he: 'סגור את כל הטאבים', command: 'workbench.action.closeAllEditors' },
  { suffix: 'tab.reopenClosed', en: 'reopen closed tab', he: 'פתח מחדש טאב שנסגר', command: 'workbench.action.reopenClosedEditor' },
  { suffix: 'tab.next', en: 'next tab', he: 'לטאב הבא', command: 'workbench.action.nextEditor' },
  { suffix: 'tab.previous', en: 'previous tab', he: 'לטאב הקודם', command: 'workbench.action.previousEditor' },
  { suffix: 'tab.first', en: 'first tab', he: 'לטאב הראשון', command: 'workbench.action.firstEditorInGroup' },
  { suffix: 'tab.last', en: 'last tab', he: 'לטאב האחרון', command: 'workbench.action.lastEditorInGroup' },
  { suffix: 'tab.pin', en: 'pin tab', he: 'נעץ טאב', command: 'workbench.action.pinEditor' },
  { suffix: 'group.splitRight', en: 'split editor right', he: 'פצל עורך ימינה', command: 'workbench.action.splitEditorRight' },
  { suffix: 'group.splitDown', en: 'split editor down', he: 'פצל עורך למטה', command: 'workbench.action.splitEditorDown' },
  { suffix: 'group.focusLeft', en: 'focus left group', he: 'עבור לקבוצה משמאל', command: 'workbench.action.focusLeftGroup' },
  { suffix: 'group.focusRight', en: 'focus right group', he: 'עבור לקבוצה מימין', command: 'workbench.action.focusRightGroup' },
  { suffix: 'group.focusAbove', en: 'focus group above', he: 'עבור לקבוצה מעל', command: 'workbench.action.focusAboveGroup' },
  { suffix: 'group.focusBelow', en: 'focus group below', he: 'עבור לקבוצה מתחת', command: 'workbench.action.focusBelowGroup' },
]);
