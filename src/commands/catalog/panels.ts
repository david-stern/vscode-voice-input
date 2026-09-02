import { definitions } from './helpers';

export const PANEL_COMMANDS = definitions('panels-debug-tests', [
  { suffix: 'panel.toggleTerminal', en: 'toggle terminal', he: 'הצג או הסתר טרמינל', command: 'workbench.action.terminal.toggleTerminal' },
  { suffix: 'panel.newTerminal', en: 'new terminal', he: 'טרמינל חדש', command: 'workbench.action.terminal.new', risk: 'confirmation-required' },
  { suffix: 'panel.explorer', en: 'focus explorer', he: 'פתח סייר קבצים', command: 'workbench.view.explorer' },
  { suffix: 'panel.search', en: 'focus search', he: 'פתח חיפוש', command: 'workbench.view.search' },
  { suffix: 'panel.sourceControl', en: 'focus source control', he: 'פתח בקרת מקור', command: 'workbench.view.scm' },
  { suffix: 'panel.problems', en: 'focus problems', he: 'פתח בעיות', command: 'workbench.actions.view.problems' },
  { suffix: 'panel.toggle', en: 'toggle panel', he: 'הצג או הסתר פאנל', command: 'workbench.action.togglePanel' },
  { suffix: 'debug.start', en: 'start debugging', he: 'התחל debug', command: 'workbench.action.debug.start', risk: 'confirmation-required' },
  { suffix: 'debug.stop', en: 'stop debugging', he: 'עצור debug', command: 'workbench.action.debug.stop', risk: 'confirmation-required' },
  { suffix: 'debug.restart', en: 'restart debugging', he: 'הפעל debug מחדש', command: 'workbench.action.debug.restart', risk: 'confirmation-required' },
  { suffix: 'debug.stepOver', en: 'step over', he: 'דלג מעל', command: 'workbench.action.debug.stepOver' },
  { suffix: 'debug.stepInto', en: 'step into', he: 'היכנס פנימה', command: 'workbench.action.debug.stepInto' },
  { suffix: 'test.runAll', en: 'run all tests', he: 'הרץ את כל הבדיקות', command: 'testing.runAll', risk: 'confirmation-required' },
]);
