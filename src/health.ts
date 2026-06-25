const WINDOW = 20;

export interface SourceHealth {
  id: string;
  successRate: number;
  avgLatencyMs: number;
  calls: number;
}

interface Entry {
  ok: boolean;
  ms: number;
}

class SourceTracker {
  private window: Entry[] = [];
  private cursor = 0;
  private total = 0;

  record(ok: boolean, ms: number): void {
    if (this.window.length < WINDOW) {
      this.window.push({ ok, ms });
    } else {
      this.window[this.cursor % WINDOW] = { ok, ms };
    }
    this.cursor++;
    this.total++;
  }

  snapshot(): { successRate: number; avgLatencyMs: number; calls: number } {
    if (this.window.length === 0) return { successRate: 1, avgLatencyMs: 0, calls: 0 };
    const ok = this.window.filter((e) => e.ok).length;
    const avg = this.window.reduce((s, e) => s + e.ms, 0) / this.window.length;
    return {
      successRate: ok / this.window.length,
      avgLatencyMs: avg,
      calls: this.total,
    };
  }
}

export class HealthTracker {
  private trackers = new Map<string, SourceTracker>();

  private tracker(id: string): SourceTracker {
    let t = this.trackers.get(id);
    if (!t) {
      t = new SourceTracker();
      this.trackers.set(id, t);
    }
    return t;
  }

  record(id: string, ok: boolean, ms: number): void {
    this.tracker(id).record(ok, ms);
  }

  snapshot(): SourceHealth[] {
    const out: SourceHealth[] = [];
    for (const [id, t] of this.trackers) {
      out.push({ id, ...t.snapshot() });
    }
    return out;
  }

  get(id: string): SourceHealth {
    const s = this.trackers.get(id)?.snapshot() ?? { successRate: 1, avgLatencyMs: 0, calls: 0 };
    return { id, ...s };
  }
}
