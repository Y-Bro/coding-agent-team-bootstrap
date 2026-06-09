import type { FileSystem } from "../ports/fs.ts";
import { trace } from "../obs/trace.ts";

/** The daemon surface the lifecycle drives (a NodeSocketServer-backed daemon). */
export interface DaemonLike {
  start(socket: string): Promise<void>;
  stop(): Promise<void>;
}

/** The bootstrap surface the lifecycle drives. */
export interface BootstrapLike {
  up(socket: string): Promise<void>;
  down(): Promise<void>;
}

/** Injectable process controls so the lifecycle tests headlessly. */
export interface ProcessControl {
  readonly pid: number;
  kill(pid: number, signal: string): void;
  /** Register an async clean-shutdown handler (SIGINT/SIGTERM). */
  onShutdown(handler: () => void): void;
  /** Register a synchronous best-effort cleanup on process exit. */
  onExit(handler: () => void): void;
}

export interface LifecycleDeps {
  fs: FileSystem;
  proc: ProcessControl;
  pidfile: string;
  /** The broker socket path — removed on shutdown/exit so a crash can't poison the next run. */
  socket: string;
}

/**
 * Start the broker daemon and bootstrap the team, then record the owning pid
 * and stay alive: the socket server holds the event loop open. A shutdown
 * signal tears the team down, stops the daemon, and clears the pidfile.
 * Crucially it does NOT exit the process — the broker must remain reachable
 * for later `team send`/`team inbox`.
 */
export async function teamUp(
  daemon: DaemonLike,
  bootstrapper: BootstrapLike,
  socket: string,
  deps: LifecycleDeps,
): Promise<void> {
  trace("lifecycle", `teamUp: daemon.start(${socket})`);
  await daemon.start(socket);
  trace("lifecycle", "teamUp: bootstrapper.up (worktrees → cards → register → spawn)");
  try {
    await bootstrapper.up(socket);
  } catch (e) {
    // Partial bring-up: stop the daemon and clear the pidfile/socket so a failed
    // `team up` leaves no stale daemon/socket to poison the next run, then re-throw.
    trace("lifecycle", "teamUp: bootstrap FAILED → ROLLBACK (daemon.stop + cleanup pidfile/socket)");
    try { await daemon.stop(); } finally { cleanup(deps); }
    throw e;
  }
  deps.fs.write(deps.pidfile, String(deps.proc.pid));
  trace("lifecycle", `teamUp: wrote pidfile ${deps.pidfile}=${deps.proc.pid}; staying alive`);
  deps.proc.onShutdown(() => {
    trace("lifecycle", "shutdown: bootstrapper.down → daemon.stop → cleanup");
    void (async () => {
      try {
        await bootstrapper.down();
      } finally {
        await daemon.stop();
        cleanup(deps);
      }
    })();
  });
  // Synchronous backstop: a crash/exit must not leave a stale socket or pidfile.
  deps.proc.onExit(() => cleanup(deps));
}

/** Remove the pidfile + socket so the next `team up` starts from a clean slate. */
function cleanup(deps: LifecycleDeps): void {
  deps.fs.remove(deps.pidfile);
  deps.fs.remove(deps.socket);
}

/**
 * Stop the RUNNING daemon by signalling the pid recorded in the pidfile, then
 * clear the pidfile. Returns false when no daemon is recorded.
 */
export async function teamDown(deps: LifecycleDeps, signal = "SIGTERM"): Promise<boolean> {
  if (!deps.fs.exists(deps.pidfile)) { trace("lifecycle", "teamDown: no pidfile → no running broker"); return false; }
  const pid = Number(deps.fs.read(deps.pidfile).trim());
  trace("lifecycle", `teamDown: kill pid=${pid} (${signal}) + cleanup pidfile/socket`);
  deps.proc.kill(pid, signal);
  cleanup(deps);
  return true;
}
