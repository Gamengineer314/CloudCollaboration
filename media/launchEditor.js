const vscode = acquireVsCodeApi();

vscode.postMessage({ type: 'openFolder' })


function connect() {
    document.body.innerHTML = '<h1>Connecting...</h1>';
    vscode.postMessage({ type: 'connect' });
}

function openFolder() {
    vscode.postMessage({ type: 'openFolder' });
}