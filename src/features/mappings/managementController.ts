import { MappingError, type CustomMapping } from '../../assistant';
import type { MappingApprovalStore } from '../../agents';
import { nextRevision, type Revision } from '../../webview/protocol';
import { MappingDraftWizard } from './draftWizard';
import { mappingTargetId, type Localize } from './pendingActionController';
import type { MappingManagementHost } from './ports';
import type { MappingStore } from './store';

export interface MappingManagementOptions {
  store: MappingStore;
  host: MappingManagementHost;
  localize: Localize;
  isWorkspaceTrusted(): boolean;
  approvals?: Pick<MappingApprovalStore, 'state' | 'grant' | 'revoke'>;
  invalidatePending(): void;
  publish(): Promise<void> | void;
}

export interface SettingsMappingCard {
  id: string;
  label: string;
  description: string;
  phrases: string[];
  kind: 'command' | 'language-model-tool';
  targetId: string;
  enabled: boolean;
  agentEnabled: boolean;
}

export interface MappingCollectionSnapshot {
  revision: Revision;
  status: 'ready' | 'untrusted' | 'error';
  items: SettingsMappingCard[];
}

export type MappingMutationStatus =
  | 'accepted'
  | 'cancelled'
  | 'stale'
  | 'not-found'
  | 'unchanged'
  | 'failed';

export interface MappingMutationResult {
  status: MappingMutationStatus;
  snapshot: MappingCollectionSnapshot;
}

interface MutationContext {
  authorizedRevision: Revision;
}

/**
 * Native-dialog mapping editor and serialized Settings mutation authority.
 * The Settings surface receives presentation fields only; static inputs remain host-side.
 */
export class MappingManagementController {
  private readonly wizard: MappingDraftWizard;
  private collectionRevision: Revision = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: MappingManagementOptions) {
    this.wizard = new MappingDraftWizard(options.host, options.localize);
  }

  snapshot(): MappingCollectionSnapshot {
    this.reloadAndObserve();
    return this.currentSnapshot();
  }

  async manage(): Promise<void> {
    while (true) {
      this.reloadAndObserve();
      const mappings = this.options.store.list();
      const selected = await this.options.host.pick([
        {
          label: this.text('$(add) Add custom action', '$(add) הוספת פעולה מותאמת'),
          description: this.text(
            'Map an exact voice phrase to a public command or tool',
            'מיפוי ביטוי קולי מדויק לפקודה או לכלי ציבורי',
          ),
          id: '__add__',
        },
        ...mappings.map((mapping) => ({
          label: `${mapping.enabled ? '$(pass-filled)' : '$(circle-slash)'} ${mapping.label}`,
          description: `${mapping.kind === 'command'
            ? this.text('Command', 'פקודה')
            : this.text('Tool', 'כלי')} · ${mappingTargetId(mapping)}`,
          detail: this.text(
            `${mapping.phrases.join(' | ')} · Agent: ${mapping.agentEnabled ? 'available' : 'private'} · Always approved: ${this.options.approvals?.state(mapping.id) === 'approved' ? 'yes' : 'no'}`,
            `${mapping.phrases.join(' | ')} · סוכן: ${mapping.agentEnabled ? 'זמין' : 'פרטי'} · מאושר תמיד: ${this.options.approvals?.state(mapping.id) === 'approved' ? 'כן' : 'לא'}`,
          ),
          id: mapping.id,
        })),
      ], {
        title: this.text('Voice Input: Custom actions', 'Voice Input: פעולות מותאמות'),
        placeHolder: this.text(
          'Choose a mapping to manage; Escape closes this list',
          'בחר מיפוי לניהול; Escape סוגר את הרשימה',
        ),
        matchOnDescription: true,
        matchOnDetail: true,
      });
      if (!selected) return;
      if (selected.id === '__add__') {
        await this.add();
        continue;
      }
      const mapping = this.options.store.get(selected.id);
      if (!mapping) continue;
      const approvalState = this.options.approvals?.state(mapping.id) ?? 'none';
      const action = await this.options.host.pick([
        { label: this.text('$(edit) Edit', '$(edit) עריכה'), action: 'edit' as const },
        {
          label: mapping.enabled
            ? this.text('$(circle-slash) Disable voice action', '$(circle-slash) השבתת פעולה קולית')
            : this.text('$(pass-filled) Enable voice action', '$(pass-filled) הפעלת פעולה קולית'),
          action: 'toggle-enabled' as const,
        },
        {
          label: mapping.agentEnabled
            ? this.text('$(lock) Hide from Agent Mode', '$(lock) הסתרה ממצב Agent')
            : this.text('$(hubot) Make available to Agent Mode', '$(hubot) הפיכה לזמינה למצב Agent'),
          action: 'toggle-agent' as const,
        },
        ...(this.options.approvals && mapping.enabled && mapping.agentEnabled ? [{
          label: approvalState === 'approved'
            ? this.text(
              '$(shield) Require confirmation in Agent Mode',
              '$(shield) דרישת אישור במצב Agent',
            )
            : this.text(
              '$(verified) Always approve this exact mapping',
              '$(verified) אישור תמידי למיפוי המדויק הזה',
            ),
          action: 'toggle-approval' as const,
        }] : []),
        { label: this.text('$(trash) Delete', '$(trash) מחיקה'), action: 'delete' as const },
      ], {
        title: mapping.label,
        placeHolder: mappingTargetId(mapping),
      });
      if (!action) continue;
      if (action.action === 'edit') await this.edit(mapping.id);
      else if (action.action === 'toggle-enabled') {
        await this.setEnabled(mapping.id, !mapping.enabled);
      } else if (action.action === 'toggle-agent') {
        await this.setAgentEnabled(mapping.id, !mapping.agentEnabled);
      } else if (action.action === 'toggle-approval') {
        await this.setAlwaysApproved(mapping.id, approvalState !== 'approved');
      } else await this.delete(mapping.id);
    }
  }

  add(expectedRevision?: Revision): Promise<MappingMutationResult> {
    return this.serialize(expectedRevision, async (context) => {
      const selectionCatalog = await this.wizard.discoverTargets();
      const draft = await this.wizard.prompt(selectionCatalog);
      if (!draft) return this.result('cancelled');
      const currentCatalog = await this.wizard.discoverTargets();
      if (!this.isStillAuthorized(context)) return this.result('stale');
      const saved = await this.options.store.create(draft, currentCatalog);
      return this.accept(this.text(
        `Voice Input: “${saved.label}” was saved with a new secure mapping ID.`,
        `Voice Input: המיפוי „${saved.label}” נשמר עם מזהה מאובטח חדש.`,
      ));
    });
  }

  edit(id: string, expectedRevision?: Revision): Promise<MappingMutationResult> {
    return this.serialize(expectedRevision, async (context) => {
      const existing = this.options.store.get(id);
      if (!existing) return this.result('not-found');
      const selectionCatalog = await this.wizard.discoverTargets();
      const draft = await this.wizard.prompt(selectionCatalog, existing);
      if (!draft) return this.result('cancelled');
      const currentCatalog = await this.wizard.discoverTargets();
      if (!this.isStillAuthorized(context)) return this.result('stale');
      const saved = await this.options.store.replace(id, draft, currentCatalog);
      return this.accept(this.text(
        `Voice Input: “${saved.label}” was saved with a new secure mapping ID.`,
        `Voice Input: המיפוי „${saved.label}” נשמר עם מזהה מאובטח חדש.`,
      ));
    });
  }

  toggleEnabled(id: string, expectedRevision: Revision): Promise<MappingMutationResult> {
    return this.changeFlag(id, expectedRevision, 'enabled');
  }

  toggleAgentEnabled(id: string, expectedRevision: Revision): Promise<MappingMutationResult> {
    return this.changeFlag(id, expectedRevision, 'agentEnabled');
  }

  setEnabled(
    id: string,
    enabled: boolean,
    expectedRevision?: Revision,
  ): Promise<MappingMutationResult> {
    return this.setFlag(id, enabled, 'enabled', expectedRevision);
  }

  setAgentEnabled(
    id: string,
    agentEnabled: boolean,
    expectedRevision?: Revision,
  ): Promise<MappingMutationResult> {
    return this.setFlag(id, agentEnabled, 'agentEnabled', expectedRevision);
  }

  delete(id: string, expectedRevision?: Revision): Promise<MappingMutationResult> {
    return this.serialize(expectedRevision, async (context) => {
      const mapping = this.options.store.get(id);
      if (!mapping) return this.result('not-found');
      const confirmed = await this.options.host.confirmWarning(
        this.text(
          `Delete “${mapping.label}”? Its voice phrase and Agent ID will stop working immediately.`,
          `למחוק את „${mapping.label}”? הביטוי הקולי ומזהה ה־Agent יפסיקו לפעול מיד.`,
        ),
        this.text('Delete', 'מחיקה'),
      );
      if (!confirmed) return this.result('cancelled');
      if (!this.isStillAuthorized(context)) return this.result('stale');
      await this.options.store.delete(id);
      return this.accept(this.text(
        `Voice Input: “${mapping.label}” was deleted. Its old voice phrases and Agent ID can no longer run.`,
        `Voice Input: „${mapping.label}” נמחק. הביטויים הקוליים ומזהה ה־Agent הישנים אינם יכולים עוד לפעול.`,
      ));
    });
  }

  setAlwaysApproved(
    id: string,
    approved: boolean,
    expectedRevision?: Revision,
  ): Promise<MappingMutationResult> {
    return this.serialize(expectedRevision, async (context) => {
      const approvals = this.options.approvals;
      const mapping = this.options.store.get(id);
      if (!approvals || !mapping) return this.result('not-found');
      if (!mapping.enabled || !mapping.agentEnabled || !this.options.isWorkspaceTrusted()) {
        return this.result('failed');
      }
      const confirmed = await this.options.host.confirmWarning(
        approved
          ? this.text(
            `Always approve “${mapping.label}” only while this exact opaque mapping ID, target, and saved static input remain unchanged?`,
            `לאשר תמיד את „${mapping.label}” רק כל עוד מזהה המיפוי האטום, היעד והקלט הקבוע שנשמר נשארים ללא שינוי?`,
          )
          : this.text(
            `Revoke always-approved access for “${mapping.label}”?`,
            `לבטל את האישור התמידי עבור „${mapping.label}”?`,
          ),
        approved
          ? this.text('Always approve exact mapping', 'אישור תמידי למיפוי המדויק')
          : this.text('Revoke approval', 'ביטול האישור'),
      );
      if (!confirmed || !this.isStillAuthorized(context)) return this.result('cancelled');
      if (approved) await approvals.grant(id);
      else await approvals.revoke(id);
      return this.accept(approved
        ? this.text(
          `Voice Input: “${mapping.label}” is always approved only for its current exact fingerprint.`,
          `Voice Input: „${mapping.label}” מאושר תמיד רק עבור טביעת האצבע המדויקת הנוכחית שלו.`,
        )
        : this.text(
          `Voice Input: always-approved access for “${mapping.label}” was revoked.`,
          `Voice Input: האישור התמידי עבור „${mapping.label}” בוטל.`,
        ));
    });
  }

  private changeFlag(
    id: string,
    expectedRevision: Revision,
    flag: 'enabled' | 'agentEnabled',
  ): Promise<MappingMutationResult> {
    return this.serialize(expectedRevision, async (context) => {
      const mapping = this.options.store.get(id);
      if (!mapping) return this.result('not-found');
      return this.persistFlag(mapping, !mapping[flag], flag, context);
    });
  }

  private setFlag(
    id: string,
    value: boolean,
    flag: 'enabled' | 'agentEnabled',
    expectedRevision?: Revision,
  ): Promise<MappingMutationResult> {
    return this.serialize(expectedRevision, async (context) => {
      const mapping = this.options.store.get(id);
      if (!mapping) return this.result('not-found');
      if (mapping[flag] === value) return this.result('unchanged');
      return this.persistFlag(mapping, value, flag, context);
    });
  }

  private async persistFlag(
    mapping: CustomMapping,
    value: boolean,
    flag: 'enabled' | 'agentEnabled',
    context: MutationContext,
  ): Promise<MappingMutationResult> {
    const currentCatalog = await this.wizard.discoverTargets();
    if (!this.isStillAuthorized(context)) return this.result('stale');
    const draft = { ...this.wizard.editableDraft(mapping), [flag]: value };
    const saved = await this.options.store.replace(mapping.id, draft, currentCatalog);
    return this.accept(this.flagFeedback(saved, flag));
  }

  private serialize(
    expectedRevision: Revision | undefined,
    operation: (context: MutationContext) => Promise<MappingMutationResult>,
  ): Promise<MappingMutationResult> {
    let resolveResult!: (result: MappingMutationResult) => void;
    const result = new Promise<MappingMutationResult>((resolve) => { resolveResult = resolve; });
    const run = async () => {
      try {
        this.reloadAndObserve();
        if (expectedRevision !== undefined && expectedRevision !== this.collectionRevision) {
          resolveResult(this.result('stale'));
          return;
        }
        resolveResult(await operation({ authorizedRevision: this.collectionRevision }));
      } catch (error) {
        await this.options.host.showError(`Voice Input: ${this.errorMessage(error)}`);
        resolveResult(this.result('failed'));
      }
    };
    this.queue = this.queue.then(run, run);
    return result;
  }

  private isStillAuthorized(context: MutationContext): boolean {
    this.reloadAndObserve();
    return context.authorizedRevision === this.collectionRevision;
  }

  private reloadAndObserve(): void {
    if (this.options.store.reload().changed) this.advanceRevision();
  }

  private async accept(feedback: string): Promise<MappingMutationResult> {
    this.advanceRevision();
    this.options.invalidatePending();
    await Promise.allSettled([
      Promise.resolve().then(() => this.options.host.showInformation(feedback)),
      Promise.resolve().then(() => this.options.publish()),
    ]);
    return this.result('accepted');
  }

  private advanceRevision(): void {
    this.collectionRevision = nextRevision(this.collectionRevision);
  }

  private result(status: MappingMutationStatus): MappingMutationResult {
    return { status, snapshot: this.currentSnapshot() };
  }

  private currentSnapshot(): MappingCollectionSnapshot {
    return {
      revision: this.collectionRevision,
      status: this.options.store.corrupted
        ? 'error'
        : this.options.isWorkspaceTrusted() ? 'ready' : 'untrusted',
      items: this.options.store.list().map((mapping) => ({
        id: mapping.id,
        label: mapping.label,
        description: mapping.description,
        phrases: [...mapping.phrases],
        kind: mapping.kind,
        targetId: mappingTargetId(mapping),
        enabled: mapping.enabled,
        agentEnabled: mapping.agentEnabled,
      })),
    };
  }

  private flagFeedback(mapping: CustomMapping, flag: 'enabled' | 'agentEnabled'): string {
    if (flag === 'enabled') {
      return mapping.enabled
        ? this.text(
          `Voice Input: “${mapping.label}” is enabled. Mutating requests need confirmation unless this exact mapping is separately always approved.`,
          `Voice Input: „${mapping.label}” פעיל. בקשות משנות דורשות אישור אלא אם המיפוי המדויק הזה אושר תמיד בנפרד.`,
        )
        : this.text(
          `Voice Input: “${mapping.label}” is disabled and will not match voice requests.`,
          `Voice Input: „${mapping.label}” מושבת ולא יתאים לבקשות קוליות.`,
        );
    }
    return mapping.agentEnabled
      ? this.text(
        `Voice Input: “${mapping.label}” is available to Agent Mode by its new opaque ID. It requires confirmation until this exact mapping is separately always approved.`,
        `Voice Input: „${mapping.label}” זמין למצב Agent באמצעות מזהה אטום חדש. הוא דורש אישור עד שהמיפוי המדויק הזה יאושר תמיד בנפרד.`,
      )
      : this.text(
        `Voice Input: “${mapping.label}” is hidden from Agent Mode.`,
        `Voice Input: „${mapping.label}” מוסתר ממצב Agent.`,
      );
  }

  private errorMessage(error: unknown): string {
    if (error instanceof MappingError) return this.options.localize(error.en, error.he);
    return this.text('The mapping operation failed safely.', 'פעולת המיפוי נכשלה באופן בטוח.');
  }

  private text(english: string, hebrew: string): string {
    return this.options.localize(english, hebrew);
  }
}
