export interface MultiTabLeaderOptions {
  onLeaderChange?: (isLeader: boolean) => void;
}

export class MultiTabLeader {
  private leader = false;
  private options: MultiTabLeaderOptions;
  private abortController: AbortController | null = null;
  private channel: BroadcastChannel | null = null;
  private tabId: string;
  private heartbeatTimer: any = null;

  constructor(options: MultiTabLeaderOptions = {}) {
    this.options = options;
    this.tabId = `tab_${Math.random().toString(36).slice(2, 9)}_${Date.now()}`;
  }

  public isLeader(): boolean {
    return this.leader;
  }

  private setLeader(isLeader: boolean) {
    if (this.leader !== isLeader) {
      this.leader = isLeader;
      this.options.onLeaderChange?.(isLeader);
    }
  }

  public start(): void {
    if (typeof window === 'undefined') {
      this.setLeader(true);
      return;
    }

    // Modern Web Locks API
    if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
      this.abortController = new AbortController();
      navigator.locks
        .request(
          'acb-transaction-voice-leader',
          { signal: this.abortController.signal },
          () => {
            this.setLeader(true);
            return new Promise<void>((resolve) => {
              this.abortController?.signal.addEventListener('abort', () => {
                this.setLeader(false);
                resolve();
              });
            });
          }
        )
        .catch(() => {
          this.setLeader(false);
        });
      return;
    }

    // BroadcastChannel fallback
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel('acb-voice-leader-channel');
        let currentLeaderId: string | null = null;
        let lastLeaderHeartbeat = 0;

        this.channel.onmessage = (ev) => {
          const { type, tabId } = ev.data || {};
          if (type === 'heartbeat') {
            currentLeaderId = tabId;
            lastLeaderHeartbeat = Date.now();
            if (this.leader && tabId !== this.tabId) {
              // Yield if someone else claimed
              this.setLeader(false);
            }
          } else if (type === 'claim' && tabId !== this.tabId) {
            currentLeaderId = tabId;
            lastLeaderHeartbeat = Date.now();
            this.setLeader(false);
          }
        };

        const tryClaim = () => {
          const now = Date.now();
          if (!currentLeaderId || now - lastLeaderHeartbeat > 4000) {
            currentLeaderId = this.tabId;
            this.setLeader(true);
            this.channel?.postMessage({ type: 'claim', tabId: this.tabId });
          }
          if (this.leader) {
            this.channel?.postMessage({ type: 'heartbeat', tabId: this.tabId });
          }
        };

        tryClaim();
        this.heartbeatTimer = setInterval(tryClaim, 2000);
        return;
      } catch {
        // Fallback to standalone leader
      }
    }

    // Standalone tab is leader
    this.setLeader(true);
  }

  public stop(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.setLeader(false);
  }
}
