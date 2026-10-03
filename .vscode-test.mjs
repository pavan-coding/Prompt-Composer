// Integration tests: Mocha inside a real Extension Development Host (@vscode/test-cli).
// The workspace is a fresh temporary copy of test/fixtures/workspace (with its symlinks/junctions).
// Set CODE_EXE to use an installed VS Code instead of downloading the latest stable build.
import { defineConfig } from '@vscode/test-cli';
import { prepareWorkspace } from './test/integration/setup.mjs';

const workspace = prepareWorkspace();
const install = process.env.CODE_EXE ? { useInstallation: { fromPath: process.env.CODE_EXE } } : { version: 'stable' };

export default defineConfig({
  label: 'integration',
  files: 'out/test/integration/**/*.test.js',
  workspaceFolder: workspace,
  ...install,
  launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  env: { PROMPT_COMPOSER_TEST: '1' },
  mocha: { ui: 'tdd', timeout: 40000, color: true },
});
