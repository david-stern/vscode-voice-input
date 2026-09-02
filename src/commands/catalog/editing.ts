import { definitions } from './helpers';

export const EDITING_COMMANDS = definitions('editing', [
  { suffix: 'edit.copy', en: 'copy', he: 'העתק', command: 'editor.action.clipboardCopyAction' },
  { suffix: 'edit.paste', en: 'paste', he: 'הדבק', command: 'editor.action.clipboardPasteAction' },
  { suffix: 'edit.cut', en: 'cut', he: 'גזור', command: 'editor.action.clipboardCutAction' },
  { suffix: 'edit.undo', en: 'undo', he: 'בטל', command: 'undo' },
  { suffix: 'edit.redo', en: 'redo', he: 'בצע שוב', command: 'redo' },
  { suffix: 'edit.selectAll', en: 'select all', he: 'בחר הכול', command: 'editor.action.selectAll' },
  { suffix: 'edit.deleteLine', en: 'delete line', he: 'מחק שורה', command: 'editor.action.deleteLines' },
  { suffix: 'edit.copyLineDown', en: 'copy line down', he: 'שכפל שורה למטה', command: 'editor.action.copyLinesDownAction' },
  { suffix: 'edit.copyLineUp', en: 'copy line up', he: 'שכפל שורה למעלה', command: 'editor.action.copyLinesUpAction' },
  { suffix: 'edit.moveLineDown', en: 'move line down', he: 'הזז שורה למטה', command: 'editor.action.moveLinesDownAction' },
  { suffix: 'edit.moveLineUp', en: 'move line up', he: 'הזז שורה למעלה', command: 'editor.action.moveLinesUpAction' },
  { suffix: 'edit.insertLineBelow', en: 'insert line below', he: 'הוסף שורה מתחת', command: 'editor.action.insertLineAfter' },
  { suffix: 'edit.insertLineAbove', en: 'insert line above', he: 'הוסף שורה מעל', command: 'editor.action.insertLineBefore' },
  { suffix: 'edit.joinLines', en: 'join lines', he: 'חבר שורות', command: 'editor.action.joinLines' },
  { suffix: 'edit.indentLine', en: 'indent line', he: 'הכנס הזחה', command: 'editor.action.indentLines' },
  { suffix: 'edit.outdentLine', en: 'outdent line', he: 'הוצא הזחה', command: 'editor.action.outdentLines' },
  { suffix: 'edit.toggleLineComment', en: 'toggle line comment', he: 'החלף הערת שורה', command: 'editor.action.commentLine' },
  { suffix: 'edit.toggleBlockComment', en: 'toggle block comment', he: 'החלף הערת בלוק', command: 'editor.action.blockComment' },
]);
