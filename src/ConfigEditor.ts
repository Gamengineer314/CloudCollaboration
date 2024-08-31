import * as vscode from 'vscode';
import { randomString, showErrorWrap } from './util';
import { Config, Project } from './Project';
import { context } from './extension';
import { GoogleDrive, GoogleDriveProject } from './GoogleDrive';


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
            // Update the project variable
            project = JSON.parse(document.getText()) as Config;

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
                updateWebview();
            }
        });
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });


        // Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage(showErrorWrap(async e => {
			switch (e.type) {
                case 'on_load':
                    updateWebview();
                    return;

                case  'remove_member':
                    await this.removeMember(e.index, project, document);
                    return;
                
                case 'remove_invite':
                    await this.removeInvite(e.index, project, document);
                    return;
                
                case 'add_member':
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Inviting member..." }, showErrorWrap(this.addMember.bind(this, e.email, project, document)));
                    return;
			}
		}));
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

                <div id="add_member_div">
                    <button id="add_member" class="add_button">+</button>
                    <input id="add_member_input" type="text" placeholder="Add member by email">
                    <button id="confirm_add" class="add_button">Add</button>
                    <button id="cancel_add" class="add_button">Cancel</button>
                </div>
                
                <script nonce="${nonce}" src="${configEditorJs}"></script>
            </body>
        `;
    }


    /**
     * @brief Remove a member from the project
     * @param index Index of the member to remove
     * @param project Config object
     * @param document vscode.TextDocument object
    **/
    private async removeMember(index: number, project: Config, document: vscode.TextDocument) {
        // Make a copy of the permission so we can later ask google drive to remove it
        const member = project.shareConfig.members[index];

        // Remove the email from the shareConfig
        project.shareConfig.members.splice(index, 1);
        // Save the new config
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(project, null, 4));
        vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(document.uri);

        // Remove the member from the google drive
        if (!GoogleDrive.Instance) {
            throw new Error("Config Editor removeMember failed : not authenticated");
        }
        if (!Project.Instance) {
            throw new Error("Config Editor removeMember failed : not connected");
        }
        await GoogleDrive.Instance.unshare(Project.Instance.Project, member);

        // Add little pop-up to confirm the removal
        vscode.window.showInformationMessage(`User ${member.name} removed from project`);
    }


    /**
     * @brief Remove an invite from the project
     * @param index Index of the invite to remove
     * @param project Config object
     * @param document vscode.TextDocument object
    **/
    private async removeInvite(index: number, project: Config, document: vscode.TextDocument) {
        // Make a copy of the permission so we can later ask google drive to remove it
        const member = project.shareConfig.invites[index];
        
        // Remove the email from the shareConfig
        project.shareConfig.invites.splice(index, 1);
        // Save the new config
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(project, null, 4));
        vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(document.uri);

        // Remove the member from the google drive
        if (!GoogleDrive.Instance) {
            throw new Error("Config Editor removeMember failed : not authenticated");
        }
        if (!Project.Instance) {
            throw new Error("Config Editor removeMember failed : not connected");
        }

        await GoogleDrive.Instance.unshare(Project.Instance.Project, member);

        // Add little pop-up to confirm the removal
        vscode.window.showInformationMessage(`User ${member.name} removed from project`);
    }


    /**
     * @brief Add a member to the project
     * @param email The email of the member to add
     * @param project Config object
     * @param document vscode.TextDocument object
     * @returns 
    **/
    private async addMember(email: string, project: Config, document: vscode.TextDocument) {
        // Check if the email is already in the project
        if (project.shareConfig.members.some(m => m.name === email)) {
            throw new Error(`User ${email} is already in the project`);
        }
        if (project.shareConfig.invites.some(m => m.name === email)) {
            throw new Error(`User ${email} is already invited to the project`);
        }

        // Add the member to the google drive
        if (!GoogleDrive.Instance) {
            throw new Error("Config Editor addMember failed : not authenticated");
        }
        if (!Project.Instance) {
            throw new Error("Config Editor addMember failed : not connected");
        }
        
        const permission = await GoogleDrive.Instance.userShare(Project.Instance.Project, email);
        if (!permission) {
            throw new Error("Config Editor addMember failed : google drive error");
        }

        // Add the permission to the shareConfig
        project.shareConfig.invites.push(permission);
        
        // Save the new config
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(project, null, 4));
        vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(document.uri);

        // Add little pop-up to confirm the addition
        vscode.window.showInformationMessage(`User ${email} added to project`);
    }
}