// The HTML shell for both webviews: strict CSP, a nonce for our one script, local assets only.
import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';

export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, entry: 'editor' | 'library', title: string): string {
  const nonce = randomBytes(16).toString('base64');
  const asset = (p: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', ...p.split('/'))).toString();
  const csp = [
    `default-src 'none'`,
    `img-src ${webview.cspSource} data: blob: https:`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  const extra = entry === 'editor' ? `<link rel="stylesheet" href="${asset('media/icons.css')}">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="${asset('media/codicon.css')}">
${extra}
<link rel="stylesheet" href="${asset(`${entry}.css`)}">
<style nonce="${nonce}">
@font-face { font-family: "DM Sans"; font-style: normal; font-weight: 100 1000; src: url(${asset('media/dm-sans-normal.woff2')}) format("woff2"); }
@font-face { font-family: "DM Sans"; font-style: italic; font-weight: 100 1000; src: url(${asset('media/dm-sans-italic.woff2')}) format("woff2"); }
@font-face { font-family: "Inter"; font-style: normal; font-weight: 100 900; src: url(${asset('media/inter-normal.woff2')}) format("woff2"); }
</style>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${asset(`${entry}.js`)}"></script>
</body>
</html>`;
}
