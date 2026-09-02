import { definitions, slot } from './helpers';

export const GIT_COMMANDS = definitions('git', [
  { suffix: 'git.commitStaged', en: 'commit staged {message}', he: 'בצע commit למה שסומן {message}', command: 'git.commitStaged', slot: slot('message', 'commitMessage'), risk: 'confirmation-required', remote: false },
  { suffix: 'git.commitAll', en: 'commit all {message}', he: 'סמן הכול ובצע commit {message}', command: 'git.commitAll', slot: slot('message', 'commitMessage'), risk: 'confirmation-required', remote: false },
  { suffix: 'git.push', en: 'push', he: 'בצע push', command: 'git.push', risk: 'confirmation-required', remote: false },
  { suffix: 'git.pull', en: 'pull', he: 'בצע pull', command: 'git.pull', risk: 'confirmation-required', remote: false },
  { suffix: 'git.fetch', en: 'fetch', he: 'בצע fetch', command: 'git.fetch', risk: 'confirmation-required', remote: false },
  { suffix: 'git.sync', en: 'sync changes', he: 'סנכרן שינויים', command: 'git.sync', risk: 'confirmation-required', remote: false },
  { suffix: 'git.switchBranch', en: 'switch branch {branch}', he: 'עבור ל־branch {branch}', command: 'git.checkoutExistingRef', slot: slot('branch', 'existingRef'), risk: 'confirmation-required', remote: false },
  { suffix: 'git.createBranch', en: 'create branch {branch}', he: 'צור branch {branch}', command: 'git.createBranch', slot: slot('branch', 'newRef'), risk: 'confirmation-required', remote: false },
  { suffix: 'git.stageFile', en: 'stage current file', he: 'סמן את הקובץ הנוכחי', command: 'git.addCurrentResource', risk: 'confirmation-required', remote: false },
  { suffix: 'git.unstageFile', en: 'unstage current file', he: 'בטל סימון הקובץ הנוכחי', command: 'git.unstageCurrentResource', risk: 'confirmation-required', remote: false },
  { suffix: 'git.stageAll', en: 'stage all changes', he: 'סמן את כל השינויים', command: 'git.addDirtyResources', risk: 'confirmation-required', remote: false },
  { suffix: 'git.unstageAll', en: 'unstage all changes', he: 'בטל סימון כל השינויים', command: 'git.unstageIndexedResources', risk: 'confirmation-required', remote: false },
]);
