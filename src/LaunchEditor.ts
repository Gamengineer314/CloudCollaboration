import * as vscode from 'vscode';
import { GoogleDriveProject } from './GoogleDrive';
import { randomString } from './util';
import { Project } from './Project';
import { context } from './extension';


export class LaunchEditorProvider implements vscode.CustomTextEditorProvider {

    // Called when our custom editor is opened.
    public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken) : Promise<void> {
        // Get the json from the opened .collablaunch file
        const project = JSON.parse(document.getText()) as GoogleDriveProject;

        // Get if the .collablaunch file is in a subfolder
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Connection failed : no folder opened");
        }
        const documentFolder = document.uri.with({ path: document.uri.path.split("/").slice(0, -1).join("/") });
        const inSubFolder = folder.toString() !== documentFolder.toString();


        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, project.name, inSubFolder, Project.Instance !== undefined);

        // Receive message from the webview.
        webviewPanel.webview.onDidReceiveMessage(async e => {
            switch (e.type) {
                case 'openFolder':
                    this.openFolder(documentFolder);
                    return;

                case 'connect':
                    await Project.connect();
                    // Update the webview
                    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, project.name, inSubFolder, Project.Instance !== undefined);
                    return;
                
                case 'disconnect':
                    await Project.disconnect();
                    // Update the webview
                    webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, project.name, inSubFolder, Project.Instance !== undefined);
                    return;
            }
        });
    }


    /**
     * @brief This function returns the html content for the webview
     * @param webview vscode.Webview object
     * @param name Name of the opened project
     * @param inSubFolder True if the .collablaunch file is in a subfolder
     * @param connected True if vscode is already connected to the project
     * @returns The html as a string
    **/
    private getHtmlForWebview(webview: vscode.Webview, name: string, inSubFolder: boolean, connected: boolean) : string {
        // Create the html button depending on inSubFolder
        let button;
        if (connected) {
            button = /* html */`
                <button id="disconnect">Disconnect</button>
            `;
        } else {
            if (inSubFolder) {
                button = /* html */`
                    <button id="openfolder">Open Folder</button>
                `;
            }
            else {
                button = /* html */`
                    <button id="connect">Connect</button>
                `;
            }
        }
        

        // Get file paths
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'launchEditor.js'));
        const styleVsCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'launchEditor.css'));

        // Use a nonce to whitelist which scripts can be run
        const nonce = randomString(32);

        return /* html */`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                
                <link href="${styleVsCodeUri}" rel="stylesheet" />
                

                <title>${name}</title>
            </head>
            <body>
                <h1>${name}</h1>
                ${button}
                
                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();

                    function connect() {
                        document.body.innerHTML = '<h1>Connecting...</h1>';
                        vscode.postMessage({ type: 'connect' });
                    }

                    function disconnect() {
                        document.body.innerHTML = '<h1>Disconnecting...</h1>';
                        vscode.postMessage({ type: 'disconnect' });
                    }

                    function openFolder() {
                        document.body.innerHTML = '<h1>Opening Folder...</h1>';
                        vscode.postMessage({ type: 'openFolder' });
                    }

                    if (${connected}) {
                        document.getElementById('disconnect').addEventListener('click', disconnect);
                    }
                    else {
                        if (${inSubFolder}) {
                            document.getElementById('openfolder').addEventListener('click', openFolder);
                        } else {
                            document.getElementById('connect').addEventListener('click', connect);
                        }
                    }
                </script>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
        `;
    }


    /**
     * @brief Opens the specified folder with vscode (changes the active directory)
     * @param folder The folder to open
    **/
    private openFolder(folder: vscode.Uri) : void {
        vscode.commands.executeCommand('vscode.openFolder', folder);
    }
}