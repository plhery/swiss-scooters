export interface ScheduledFeed {
  id: string;
  host: string;
}

/** Independent due times and host slots keep an operator outage from blocking other operators. */
export class FeedScheduler<T extends ScheduledFeed> {
  private definitions: T[] = [];
  private readonly due = new Map<string, number>();
  private readonly active = new Map<string, string>();
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;

  constructor(private readonly collect: (feed: T) => Promise<void>, private readonly intervalMs = 60_000) {}

  setFeeds(definitions: T[]): void {
    this.definitions = definitions;
    const ids = new Set(definitions.map(feed => feed.id));
    for (const id of this.due.keys()) if (!ids.has(id)) this.due.delete(id);
    this.pump();
  }

  start(): void { this.stopped = false; this.pump(); }
  stop(): void { this.stopped = true; clearTimeout(this.timer); }

  private pump(): void {
    if (this.stopped) return;
    clearTimeout(this.timer);
    const now = Date.now();
    const pending = this.definitions.filter(feed => !this.active.has(feed.id))
      .sort((a, b) => (this.due.get(a.id) ?? 0) - (this.due.get(b.id) ?? 0));
    for (const feed of pending) {
      if (this.active.size >= 6) break;
      if ((this.due.get(feed.id) ?? 0) > now || [...this.active.values()].filter(host => host === feed.host).length >= 2) continue;
      this.active.set(feed.id, feed.host);
      this.due.set(feed.id, now + this.intervalMs);
      void this.collect(feed).catch(error => {
        console.error('Feed collection failed', feed.id, error instanceof Error ? error.name : 'UnknownError');
      }).finally(() => {
        this.active.delete(feed.id);
        this.pump();
      });
    }
    // Blocked hosts are woken by completion; future due times need only one timer.
    const nextDue = this.definitions.filter(feed => !this.active.has(feed.id))
      .map(feed => this.due.get(feed.id) ?? 0).filter(due => due > now);
    if (nextDue.length) this.timer = setTimeout(() => this.pump(), Math.max(1, Math.min(...nextDue) - now));
  }
}
