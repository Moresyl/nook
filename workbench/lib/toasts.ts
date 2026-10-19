export interface ToastMessage { id: number; message: string }
export const visibleToastLimit = 3;

export function appendToast(current: ToastMessage[], next: ToastMessage): ToastMessage[] {
  const duplicate = current.findIndex(item => item.message === next.message);
  return duplicate < 0 ? [...current, next] : current.map((item, index) => index === duplicate ? next : item);
}

export class ToastLifetime {
  private remaining = 5_000;
  private started = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private finished = false;

  constructor(private readonly onElapsed: () => void) {}

  resume() {
    if (this.finished || this.timer !== undefined) return;
    this.started = performance.now();
    this.timer = setTimeout(() => {
      this.finished = true;
      this.timer = undefined;
      this.onElapsed();
    }, this.remaining);
  }

  pause() {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.remaining = Math.max(0, this.remaining - (performance.now() - this.started));
  }

  dispose() { this.pause(); this.finished = true; }
}
