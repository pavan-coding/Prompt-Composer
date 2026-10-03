// Integration tests: Mocha inside a real Extension Development Host (@vscode/test-cli).
// The workspace is a temporary copy of test/fixtures/workspace made by test/integration/setup.mjs.
import { defineConfig } from '@vscode/test-cli';
import { prepareWorkspace } from './test/integration/setup.mjs';

const workspace = prepareWorkspace();

export default defineConfig({
  files: 'out/test/integration/**/*.test.js',
  workspaceFolder: workspace,
  version: 'stable',
  launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes'],
  env: { PROMPT_COMPOSER_TEST: '1' },
  mocha: { ui: 'tdd', timeout: 30000, color: true },
});
