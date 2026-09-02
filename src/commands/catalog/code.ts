import { definitions } from './helpers';

export const CODE_COMMANDS = definitions('code-refactor', [
  { suffix: 'code.renameSymbol', en: 'rename symbol', he: 'שנה שם סמל', command: 'editor.action.rename' },
  { suffix: 'code.quickFix', en: 'quick fix', he: 'תיקון מהיר', command: 'editor.action.quickFix' },
  { suffix: 'code.refactor', en: 'show refactor actions', he: 'פתח פעולות refactor', command: 'editor.action.refactor' },
  { suffix: 'code.formatDocument', en: 'format document', he: 'עצב מסמך', command: 'editor.action.formatDocument' },
  { suffix: 'code.formatSelection', en: 'format selection', he: 'עצב בחירה', command: 'editor.action.formatSelection' },
  { suffix: 'code.organizeImports', en: 'organize imports', he: 'ארגן imports', command: 'editor.action.organizeImports' },
  { suffix: 'code.showHover', en: 'show hover', he: 'הצג מידע', command: 'editor.action.showHover' },
  { suffix: 'code.parameterHints', en: 'show parameter hints', he: 'הצג רמזי פרמטרים', command: 'editor.action.triggerParameterHints' },
  { suffix: 'code.suggest', en: 'show suggestions', he: 'הצג השלמות', command: 'editor.action.triggerSuggest' },
  { suffix: 'code.callHierarchy', en: 'show call hierarchy', he: 'הצג היררכיית קריאות', command: 'editor.showCallHierarchy' },
]);
