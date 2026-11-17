/**
 * Serialized Per-Printer Job Queue & Concurrent Dispatch Guard
 * Prevents Win32 spooler and TCP Port 9100 collisions plus accidental reprint double-clicks.
 */

const inFlightManualLocks = new Map<string, number>();

export class PrintJobQueue {
  private chains = new Map<string, Promise<unknown>>();

  /**
   * Enqueues work sequentially per printer channel (e.g. 'cashier_usb', 'kitchen_lan')
   * without blocking parallel printing between Cashier USB and Kitchen LAN!
   */
  public enqueue<T>(channelKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(channelKey) || Promise.resolve();
    const run = previous.then(
      () => task(),
      () => task()
    );
    const settled = run.catch(() => undefined);
    this.chains.set(channelKey, settled);
    return run;
  }

  /**
   * Guards against accidental double-click reprints within cooldownMs while still allowing
   * intentional reprints after completion/cooldown.
   */
  public tryAcquireManualLock(lockKey: string, cooldownMs = 1200): boolean {
    const now = Date.now();
    const activeUntil = inFlightManualLocks.get(lockKey);
    if (activeUntil && now < activeUntil) {
      return false;
    }
    inFlightManualLocks.set(lockKey, now + cooldownMs);
    return true;
  }

  public releaseManualLock(lockKey: string): void {
    inFlightManualLocks.delete(lockKey);
  }
}

export const printJobQueue = new PrintJobQueue();
