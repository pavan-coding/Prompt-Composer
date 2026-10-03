// F5 helper: makes sure sample-workspace/ exists (a copy of the test fixture, with its symlinks and
// junctions) and builds the extension. Run by the "Run Extension" launch configuration.
import { existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { prepareWorkspace } from '../test/fixtures/prepare.mjs';

const root = resolve(import.meta.dirname, '..');
const sample = join(root, 'sample-workspace');
if (!existsSync(join(sample, 'ws'))) {
  rmSync(sample, { recursive: true, force: true });
  prepareWorkspace(sample);
  console.log(`sample workspace: ${join(sample, 'ws')}`);
}
execSync('node esbuild.mjs', { cwd: root, stdio: 'inherit' });
