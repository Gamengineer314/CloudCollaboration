import * as vscode from 'vscode';
import { randomString } from './util';
import { Config, Project } from './Project';
import { context } from './extension';
import { GoogleDrive } from './GoogleDrive';


export class ConfigEditorProvider implements vscode.CustomTextEditorProvider {

    // Called when our custom editor is opened.
    public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken) : Promise<void> {
        // Get the json from the opened .collabconfig file
        let project = JSON.parse(document.getText()) as Config;


        // Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
		};
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, project.name);

        // Update webview function
        async function updateWebview() {
            // Get the image uris
            const crown = webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'crown.png'));
            const trash = webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'trash.png'));

            if (!GoogleDrive.Instance) {
                throw(new Error("Config Editor load failed : not authenticated"));
            }

            webviewPanel.webview.postMessage({ 
                type: 'update',
                config: project.shareConfig,
                email: await GoogleDrive.Instance.getEmail(),
                uris: {
                    crown: crown.toString(),
                    trash: trash.toString()
                }
            });
        }
        // When the document changes, update the webview
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                project = JSON.parse(e.document.getText());
                updateWebview();
            }
        });
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });


        // Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage(async e => {
			switch (e.type) {
			}
		});


        // Update the webview
        updateWebview();
    }


    /**
     * @brief This function returns the html content for the webview
     * @param webview vscode.Webview object
     * @param name Name of the opened project
     * @param inSubFolder True if the .collablaunch file is in a subfolder
     * @param connected True if vscode is already connected to the project
     * @returns The html as a string
    **/
    private getHtmlForWebview(webview: vscode.Webview, name: string) : string {

        // Get file paths
        const configEditorCss = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'configEditor.css'));
        const configEditorJs = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'configEditor.js'));

        // Use a nonce to whitelist which scripts can be run
		const nonce = randomString(32);

        // Please for the sake of your mental health don't look at the hmtl code below :)
        return /* html */`
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                
                <link href="${configEditorCss}" rel="stylesheet" />
                

                <title>${name}</title>
            </head>
            <body>
                <h1>${name}</h1>
                <h2>Project Members :</h2>

                <div id="members"></div>
                
                <script nonce="${nonce}" src="${configEditorJs}"></script>
            </body>
        `;
    }
}