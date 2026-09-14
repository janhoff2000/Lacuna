import { dlopen, FFIType } from "bun:ffi";
import { closeSync, openSync } from "node:fs";
import { databasePath } from "./db";

// The descriptor, not a timestamp or row, owns the lock. Never unlink the file:
// replacing its inode could let two workers lock different files for one database.
export function acquireWorkerLock(path?: string): { path: string; release: () => void } {
  if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("Worker advisory lock supports macOS and Linux only");
  const lockPath = `${databasePath(path)}.worker.lock`;
  const library = dlopen(process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6", {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
  const fd = openSync(lockPath, "a", 0o600);
  if (library.symbols.flock(fd, 2 | 4) !== 0) {
    closeSync(fd); library.close();
    throw new Error("Another worker holds this database lock; no work was scheduled");
  }
  let released = false;
  return { path: lockPath, release: () => {
    if (released) return;
    released = true; library.symbols.flock(fd, 8); closeSync(fd); library.close();
  } };
}
