import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vi } from 'vitest';

/** Points process.cwd() at a fresh temp dir so data/secret.key never touches the repo. */
export function useTempCwd() {
  const dir = mkdtempSync(join(tmpdir(), 'evailbox-cwd-'));
  vi.spyOn(process, 'cwd').mockReturnValue(dir);
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
