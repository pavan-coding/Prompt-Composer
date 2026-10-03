// Used by .vscode-test.mjs: a fresh copy of the fixture workspace (with its links) for each run.
import { prepareWorkspace as prepare } from '../fixtures/prepare.mjs';

export function prepareWorkspace() {
  return prepare().ws;
}
