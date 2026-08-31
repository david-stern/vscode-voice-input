import {
  createSelectableMappingTargetCatalog,
  type CustomMapping,
  type CustomMappingDraft,
  type JsonObject,
  type JsonValue,
  type MappingTargetCatalog,
} from '../../assistant';
import { mappingTargetId, type Localize } from './pendingActionController';
import type { MappingManagementHost } from './ports';

/** Native-only mapping draft wizard; static arguments and tool input never enter a webview. */
export class MappingDraftWizard {
  constructor(
    private readonly host: MappingManagementHost,
    private readonly localize: Localize,
  ) {}

  async discoverTargets(): Promise<MappingTargetCatalog> {
    const catalog = await this.host.discoverTargets();
    return createSelectableMappingTargetCatalog([...catalog.commands], [...catalog.tools]);
  }

  async prompt(
    catalog: MappingTargetCatalog,
    existing?: CustomMapping,
  ): Promise<CustomMappingDraft | undefined> {
    const existingDraft = existing ? this.editableDraft(existing) : undefined;
    const kindPick = await this.host.pick([
      {
        label: this.text('VS Code command', 'פקודת VS Code'),
        description: this.text(
          'Run one currently registered public command',
          'הפעלת פקודה ציבורית שרשומה כעת',
        ),
        targetKind: 'command' as const,
      },
      {
        label: this.text('Language Model Tool', 'כלי מודל שפה'),
        description: this.text(
          'Run one public tool exposed through the VS Code API',
          'הפעלת כלי ציבורי שחשוף דרך ממשק VS Code',
        ),
        targetKind: 'language-model-tool' as const,
      },
    ], {
      title: existing
        ? this.text('Edit custom action — target type', 'עריכת פעולה מותאמת — סוג יעד')
        : this.text('Add custom action — target type', 'הוספת פעולה מותאמת — סוג יעד'),
      placeHolder: existingDraft?.kind === 'command'
        ? this.text('Current: VS Code command', 'נוכחי: פקודת VS Code')
        : existingDraft?.kind === 'language-model-tool'
          ? this.text('Current: Language Model Tool', 'נוכחי: כלי מודל שפה')
          : undefined,
    });
    if (!kindPick) return undefined;

    const targetIds = kindPick.targetKind === 'command'
      ? [...catalog.commands]
      : [...catalog.tools];
    targetIds.sort((left, right) => left.localeCompare(right));
    if (targetIds.length === 0) {
      await this.host.showError(this.text(
        kindPick.targetKind === 'command'
          ? 'No public VS Code commands are currently available.'
          : 'No public language-model tools are currently available.',
        kindPick.targetKind === 'command'
          ? 'אין כרגע פקודות VS Code ציבוריות זמינות.'
          : 'אין כרגע כלי מודל שפה ציבוריים זמינים.',
      ));
      return undefined;
    }
    const currentTarget = existing ? mappingTargetId(existing) : undefined;
    const targetPick = await this.host.pick(
      targetIds.map((id) => ({
        label: id,
        description: id === currentTarget
          ? this.text('Current target', 'היעד הנוכחי')
          : kindPick.targetKind === 'command'
            ? this.text('VS Code command', 'פקודת VS Code')
            : this.text('Language Model Tool', 'כלי מודל שפה'),
        id,
      })),
      {
        title: this.text('Choose the exact action target', 'בחירת יעד הפעולה המדויק'),
        placeHolder: this.text('Type to search registered targets', 'הקלד כדי לחפש ביעדים הרשומים'),
        matchOnDescription: true,
      },
    );
    if (!targetPick) return undefined;

    const label = await this.host.input({
      title: this.text('Action name', 'שם הפעולה'),
      prompt: this.text(
        'This name is shown before approval. Keep it clear and specific.',
        'שם זה מוצג לפני האישור. מומלץ לבחור שם ברור ומדויק.',
      ),
      value: existing?.label ?? targetPick.id,
      ignoreFocusOut: true,
    });
    if (label === undefined) return undefined;
    const description = await this.host.input({
      title: this.text('Action description', 'תיאור הפעולה'),
      prompt: this.text(
        'Optional explanation shown to Agent Mode. Static arguments remain private.',
        'הסבר אופציונלי שיוצג למצב Agent. הארגומנטים הקבועים נשארים פרטיים.',
      ),
      value: existing?.description ?? '',
      ignoreFocusOut: true,
    });
    if (description === undefined) return undefined;
    const phrasesText = await this.host.input({
      title: this.text('Exact voice phrases', 'ביטויים קוליים מדויקים'),
      prompt: this.text(
        'Separate up to eight phrases with |. Matching ignores case and repeated spaces, but is not fuzzy.',
        'הפרד עד שמונה ביטויים באמצעות |. ההתאמה מתעלמת מרישיות ומרווחים חוזרים, אך אינה משוערת.',
      ),
      value: existing?.phrases.join(' | ') ?? '',
      ignoreFocusOut: true,
    });
    if (phrasesText === undefined) return undefined;
    const common = {
      label,
      description,
      phrases: phrasesText.split('|').map((phrase) => phrase.trim()).filter(Boolean),
      enabled: existing?.enabled ?? true,
      agentEnabled: existing?.agentEnabled ?? false,
    };

    if (kindPick.targetKind === 'command') {
      const initialArgs = existingDraft?.kind === 'command' ? existingDraft.args : [];
      const args = await this.promptJsonValue<JsonValue[]>(
        this.text('Static command arguments', 'ארגומנטים קבועים לפקודה'),
        this.text(
          'Enter a small JSON array. It will be passed as separate command arguments.',
          'הזן מערך JSON קטן. הערכים יועברו כארגומנטים נפרדים לפקודה.',
        ),
        initialArgs,
        'array',
      );
      if (!args) return undefined;
      return { ...common, kind: 'command', commandId: targetPick.id, args };
    }

    const initialInput = existingDraft?.kind === 'language-model-tool'
      ? existingDraft.input
      : {};
    const input = await this.promptJsonValue<JsonObject>(
      this.text('Static tool input', 'קלט קבוע לכלי'),
      this.text(
        'Enter a small JSON object matching the selected tool schema.',
        'הזן אובייקט JSON קטן שתואם לסכמת הכלי שנבחר.',
      ),
      initialInput,
      'object',
    );
    if (!input) return undefined;
    return { ...common, kind: 'language-model-tool', toolName: targetPick.id, input };
  }

  editableDraft(mapping: CustomMapping): CustomMappingDraft {
    const common = {
      label: mapping.label,
      description: mapping.description,
      phrases: [...mapping.phrases],
      enabled: mapping.enabled,
      agentEnabled: mapping.agentEnabled,
    };
    return mapping.kind === 'command'
      ? { ...common, kind: 'command', commandId: mapping.commandId, args: mapping.args }
      : { ...common, kind: 'language-model-tool', toolName: mapping.toolName, input: mapping.input };
  }

  private async promptJsonValue<T extends JsonValue>(
    title: string,
    prompt: string,
    initial: T,
    expected: 'array' | 'object',
  ): Promise<T | undefined> {
    const value = await this.host.input({
      title,
      prompt,
      value: JSON.stringify(initial),
      ignoreFocusOut: true,
      validateInput: (candidate) => {
        try {
          const parsed: unknown = JSON.parse(candidate);
          const valid = expected === 'array'
            ? Array.isArray(parsed)
            : typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed);
          return valid ? undefined : this.text(
            expected === 'array' ? 'Enter a JSON array.' : 'Enter a JSON object.',
            expected === 'array' ? 'יש להזין מערך JSON.' : 'יש להזין אובייקט JSON.',
          );
        } catch {
          return this.text('Enter valid JSON.', 'יש להזין JSON תקין.');
        }
      },
    });
    if (value === undefined) return undefined;
    return JSON.parse(value) as T;
  }

  private text(english: string, hebrew: string): string {
    return this.localize(english, hebrew);
  }
}
