import * as vscode from 'vscode';
import { randomString, showErrorWrap } from './util';
import { Config, Project } from './Project';
import { context } from './extension';
import { GoogleDrive, GoogleDriveProject, Permission } from './GoogleDrive';


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

        // Load the inputs function
        function loadInputs() {
            webviewPanel.webview.postMessage({ 
                type: 'load_inputs',
                ignored: project.filesConfig.ignoreRules,
                static: project.filesConfig.staticRules
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
                    // Add the current user to the project members if not already in it
                    if (!GoogleDrive.Instance) {
                        throw new Error("Config Editor load failed : not authenticated");
                    }
                    const email = await GoogleDrive.Instance.getEmail();
                    // Check if the user is already in the project members or public members or is the owner
                    if (project.shareConfig.members.every(m => m.name !== email) && project.shareConfig.publicMembers.every(m => m !== email) && project.shareConfig.owner !== email) {
                        await this.addToMembers(project, document, email);
                    }

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
                
                case 'global_sharing':
                    if (e.checked) {
                        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Enabling global sharing..." }, showErrorWrap(this.enableGlobalSharing.bind(this, project, document)));
                    } else {
                        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disabling global sharing..." }, showErrorWrap(this.disableGlobalSharing.bind(this, project, document)));
                    }
                    return;

                case 'copy_link':
                    if (project.shareConfig.public) {
                        await vscode.env.clipboard.writeText(project.shareConfig.public.name);
                        vscode.window.showInformationMessage("Link copied to clipboard");
                    }
                    return;
                
                case 'save_ignored':
                    this.saveIgnored(e.value, project, document);
                    return;

                case 'save_static':
                    this.saveStatic(e.value, project, document);
                    return;
			}
		}));

        // Load inputs the first time the webview is opened
        loadInputs();
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
        
        const copyIcon = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'copy.png'));
        const helpIcon = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'media', 'help.png'));

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


                <h2 class="help_h">Global Sharing :</h2>
                <div class="help_div">
                    <img id="gs_help_icon" class="help_icon" src="${helpIcon}" />
                </div>
                <div class="help_div">
                    <span id="gs_help_text" class="help_text">Send this link to anyone you wish to share the project with. They can join the project in VSCode after opening the link and double-clicking on each file.</span>
                </div>

                <div id="global_sharing_div">
                    <input type="checkbox" id="global_sharing" />
                    <span id="global_sharing_text">Link :</span>
                    <img id="copy_button" class="icon" src="${copyIcon}" />
                    <span id="global_sharing_link"></span>
                </div>


                <h2 class="help_h">Ignored Files :</h2>
                <div class="help_div">
                    <img id="if_help_icon" class="help_icon" src="${helpIcon}" />
                </div>
                <div class="help_div">
                    <span id="if_help_text" class="help_text">Ignored files are not uploaded to Google Drive and are therefore not synchronized with your team. This can be used to improve upload/download performance. You can for example ignore temporary or compilation output files, or large files that rarely change if you share them by other means with your team.<br/>List of rules determining which files are ignored. A rule is a path that may contain special characters :<br/>- ? = any character<br/>- [abc] = a, b or c<br/>- * = any sequence of characters except '/'<br/>- ** = any sequence of characters<br/>- If a rule starts with '!', it excludes files instead of including them.</span>
                </div>

                <div><textarea id="ignored_input" type="text" placeholder="Ignored file rules"></textarea></div>
                <div id="ignored_save_div">
                    <button id="ignored_save" class="add_button">Save</button>
                    <span id="ignored_saved">Saved</span>
                </div>

                

                <h2 class="help_h">Static Files :</h2>
                <div class="help_div">
                    <img id="sf_help_icon" class="help_icon" src="${helpIcon}" />
                </div>
                <div class="help_div">
                    <span id="sf_help_text" class="help_text">Static files are uploaded/downloaded separately from the rest of the files. If a static file is modified, all static files need to be uploaded/downloaded. If a non-static file is modified, all non-static files need to be uploaded/downloaded. You should set files that rarely change as static to improve upload/download performance.<br/>List of rules determining which files are static. A rule is a path that may contain special characters :<br/>- ? = any character<br/>- [abc] = a, b or c<br/>- * = any sequence of characters except '/'<br/>- ** = any sequence of characters<br/>- If a rule starts with '!', it excludes files instead of including them.</span>
                </div>

                <div><textarea id="static_input" type="text" placeholder="Static file rules"></textarea></div>
                <div id="static_save_div">
                    <button id="static_save" class="add_button">Save</button>
                    <span id="static_saved">Saved</span>
                </div>
                
                
                
                <script nonce="${nonce}" src="${configEditorJs}"></script>
            </body>
        `;
    }


    /**
     * @brief Add the current user to the project members and remove it from the invites
     * @param project Config object
     * @param document vscode.TextDocument object
     * @param email Email of the current user
    **/
    private async addToMembers(project: Config, document: vscode.TextDocument, email: string) : Promise<void> {
        const inviteIndex = project.shareConfig.invites.findIndex(invite => invite.name === email);
        if (inviteIndex !== -1) {
            // Add the user to the members and remove it from the invites
            project.shareConfig.members.push(project.shareConfig.invites[inviteIndex]);
            project.shareConfig.invites.splice(inviteIndex, 1);
        }
        else {
            // Add the user to the public members
            project.shareConfig.publicMembers.push(email);
        }

        // Save the new config
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(project, null, 4));
        vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(document.uri);
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
        if (project.shareConfig.publicMembers.some(m => m === email)) {
            throw new Error(`User ${email} is already a global member of the project`);
        }
        //Check if the email is the owner
        if (email === project.shareConfig.owner) {
            throw new Error(`User ${email} is the owner of the project`);
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


    /**
     * @brief Enable global sharing for the project
     * @param project Config object
     * @param document vscode.TextDocument object
    **/
    private async enableGlobalSharing(project: Config, document: vscode.TextDocument) {
        // Call google drive to enable global sharing
        if (!GoogleDrive.Instance) {
            throw new Error("Config Editor enableGlobalSharing failed : not authenticated");
        }
        if (!Project.Instance) {
            throw new Error("Config Editor enableGlobalSharing failed : not connected");
        }

        const link = await GoogleDrive.Instance.publicShare(Project.Instance.Project);

        // add the link to the shareConfig
        project.shareConfig.public = link;

        // Save the new config
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(project, null, 4));
        vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(document.uri);

        // Add little pop-up to confirm the addition
        vscode.window.showInformationMessage(`Global sharing enabled for project`);
    }


    /**
     * @brief Disable global sharing for the project
     * @param project Config object
     * @param document vscode.TextDocument object
    **/
    private async disableGlobalSharing(project: Config, document: vscode.TextDocument) {
        // Call google drive to disable global sharing
        if (!GoogleDrive.Instance) {
            throw new Error("Config Editor disableGlobalSharing failed : not authenticated");
        }
        if (!Project.Instance) {
            throw new Error("Config Editor disableGlobalSharing failed : not connected");
        }
        if (!project.shareConfig.public) {
            throw new Error("Config Editor disableGlobalSharing failed : project not shared");
        }

        await GoogleDrive.Instance.unshare(Project.Instance.Project, project.shareConfig.public);

        // Remove the link from the shareConfig
        project.shareConfig.public = null;

        // Remove all public members
        project.shareConfig.publicMembers = [];

        // Save the new config
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(project, null, 4));
        vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(document.uri);

        // Add little pop-up to confirm the addition
        vscode.window.showInformationMessage(`Global sharing disabled for project`);
    }


    /**
     * @brief Save the ignored files rules
     * @param text The text in the ignored files textarea
     * @param project Config object
     * @param document vscode.TextDocument object
    **/
    private async saveIgnored(text: string[], project: Config, document: vscode.TextDocument) {
        project.filesConfig.ignoreRules = text;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(project, null, 4));
        vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(document.uri);
    }


    /**
     * @brief Save the static files rules
     * @param text The text in the static files textarea
     * @param project Config object
     * @param document vscode.TextDocument object
    **/
    private async saveStatic(text: string[], project: Config, document: vscode.TextDocument) {
        project.filesConfig.staticRules = text;
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), JSON.stringify(project, null, 4));
        vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(document.uri);
    }
}