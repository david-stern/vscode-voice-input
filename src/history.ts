import * as vscode from 'vscode';

export interface HistoryEntry {
  id: string;
  text: string;
  lang: string;
  ts: number; // epoch ms
}

const KEY = 'voiceInput.history.v1';

export class HistoryStore {
  constructor(private readonly state: vscode.Memento) {}

  private async readRaw(): Promise<HistoryEntry[]> {
    const arr = this.state.get<HistoryEntry[]>(KEY, []);
    return Array.isArray(arr) ? arr : [];
  }

  async list(ttlDays: number): Promise<HistoryEntry[]> {
    const all = await this.readRaw();
    if (ttlDays <= 0) return all.slice().sort((a, b) => b.ts - a.ts);

    const cutoff = Date.now() - ttlDays * 86_400_000;
    const fresh = all.filter((e) => e.ts >= cutoff);
    if (fresh.length !== all.length) {
      await this.state.update(KEY, fresh);
    }
    return fresh.slice().sort((a, b) => b.ts - a.ts);
  }

  async add(text: string, lang: string): Promise<HistoryEntry> {
    const entry: HistoryEntry = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      lang,
      ts: Date.now(),
    };
    const all = await this.readRaw();
    all.push(entry);
    // Cap at 500 to keep state bounded.
    const trimmed = all.length > 500 ? all.slice(-500) : all;
    await this.state.update(KEY, trimmed);
    return entry;
  }

  async remove(id: string): Promise<void> {
    const all = await this.readRaw();
    await this.state.update(KEY, all.filter((e) => e.id !== id));
  }

  async clear(): Promise<void> {
    await this.state.update(KEY, []);
  }
}
