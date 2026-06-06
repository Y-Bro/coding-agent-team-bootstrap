/** Side-effect port for delaying execution — injected so schedulers test headlessly. */
export interface Sleeper {
  sleep(ms: number): Promise<void>;
}

/** Real sleeper backed by the host timer. */
export class RealSleeper implements Sleeper {
  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
