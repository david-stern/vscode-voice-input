import { definitions, slot } from './helpers';

export const NAVIGATION_COMMANDS = definitions('search-navigation', [
  { suffix: 'navigate.quickOpen', en: 'quick open', he: 'פתיחה מהירה', command: 'workbench.action.quickOpen' },
  { suffix: 'navigate.line', en: 'go to line {line}', he: 'עבור לשורה {line}', command: 'api.editor.goToLine', slot: slot('line', 'line') },
  { suffix: 'navigate.symbol', en: 'go to symbol', he: 'עבור לסמל', command: 'workbench.action.gotoSymbol' },
  { suffix: 'navigate.definition', en: 'go to definition', he: 'עבור להגדרה', command: 'editor.action.revealDefinition' },
  { suffix: 'navigate.declaration', en: 'go to declaration', he: 'עבור להצהרה', command: 'editor.action.revealDeclaration' },
  { suffix: 'navigate.typeDefinition', en: 'go to type definition', he: 'עבור להגדרת טיפוס', command: 'editor.action.goToTypeDefinition' },
  { suffix: 'navigate.implementation', en: 'go to implementation', he: 'עבור למימוש', command: 'editor.action.goToImplementation' },
  { suffix: 'navigate.references', en: 'show references', he: 'הצג הפניות', command: 'editor.action.goToReferences' },
  { suffix: 'navigate.back', en: 'navigate back', he: 'חזור אחורה', command: 'workbench.action.navigateBack' },
  { suffix: 'navigate.forward', en: 'navigate forward', he: 'התקדם', command: 'workbench.action.navigateForward' },
  { suffix: 'search.find', en: 'find {query}', he: 'חפש {query}', command: 'api.editor.find', slot: slot('query', 'query') },
  { suffix: 'search.next', en: 'next match', he: 'לתוצאה הבאה', command: 'editor.action.nextMatchFindAction' },
  { suffix: 'search.previous', en: 'previous match', he: 'לתוצאה הקודמת', command: 'editor.action.previousMatchFindAction' },
  { suffix: 'search.replace', en: 'open replace', he: 'פתח החלפה', command: 'editor.action.startFindReplaceAction' },
  { suffix: 'search.workspace', en: 'search workspace {query}', he: 'חפש בפרויקט {query}', command: 'api.workspace.find', slot: slot('query', 'query') },
]);
