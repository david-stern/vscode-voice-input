import { definitions } from './helpers';

export const CURSOR_SELECTION_COMMANDS = definitions('cursor-selection', [
  { suffix: 'cursor.left', en: 'cursor left', he: 'סמן שמאלה', command: 'cursorLeft' },
  { suffix: 'cursor.right', en: 'cursor right', he: 'סמן ימינה', command: 'cursorRight' },
  { suffix: 'cursor.up', en: 'cursor up', he: 'סמן למעלה', command: 'cursorUp' },
  { suffix: 'cursor.down', en: 'cursor down', he: 'סמן למטה', command: 'cursorDown' },
  { suffix: 'cursor.wordLeft', en: 'word left', he: 'מילה שמאלה', command: 'cursorWordLeft' },
  { suffix: 'cursor.wordRight', en: 'word right', he: 'מילה ימינה', command: 'cursorWordRight' },
  { suffix: 'cursor.lineStart', en: 'go to line start', he: 'לתחילת השורה', command: 'cursorHome' },
  { suffix: 'cursor.lineEnd', en: 'go to line end', he: 'לסוף השורה', command: 'cursorEnd' },
  { suffix: 'cursor.documentStart', en: 'go to file start', he: 'לתחילת הקובץ', command: 'cursorTop' },
  { suffix: 'cursor.documentEnd', en: 'go to file end', he: 'לסוף הקובץ', command: 'cursorBottom' },
  { suffix: 'cursor.addAbove', en: 'add cursor above', he: 'הוסף סמן מעל', command: 'editor.action.insertCursorAbove' },
  { suffix: 'cursor.addBelow', en: 'add cursor below', he: 'הוסף סמן מתחת', command: 'editor.action.insertCursorBelow' },
  { suffix: 'selection.line', en: 'select line', he: 'בחר שורה', command: 'expandLineSelection' },
  { suffix: 'selection.expand', en: 'expand selection', he: 'הרחב בחירה', command: 'editor.action.smartSelect.expand' },
]);
