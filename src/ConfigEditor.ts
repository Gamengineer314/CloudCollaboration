import * as vscode from "vscode";
import { randomString, showErrorWrap, logError } from "./util";
import { Config, Project } from "./Project";
import { context } from "./extension";
import { GoogleDrive } from "./GoogleDrive";


export class ConfigEditorProvider implements vscode.CustomTextEditorProvider {

    private static _instance: ConfigEditorProvider | undefined = undefined;
    public static get instance() { return ConfigEditorProvider._instance; }

    public constructor() {
        if (ConfigEditorProvider.instance) {
            throw new Error("Only one instance of ConfigEditorProvider can be created");
        }
        ConfigEditorProvider._instance = this;
    }

    private config : Config = Config.default;
    private uri : vscode.Uri = vscode.Uri.parse("file:///");
    private webviews : Set<vscode.WebviewPanel> = new Set<vscode.WebviewPanel>();


    // Called when our custom editor is opened.
    public async resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, _token: vscode.CancellationToken) : Promise<void> {
        // Check uri and project instance
        if (this.uri.path === "/") {
            this.uri = document.uri;
        }
        else if (document.uri.path !== this.uri.path) {
            logError("Multiple configuration files detected");
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            return;
        }
        if (!Project.instance) {
            logError("The project is not connected");
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            return;
        }

        // Add to webviews
        this.webviews.add(webviewPanel);
        webviewPanel.onDidDispose(() => {
            this.webviews.delete(webviewPanel);
        });

        // Read configuration file the first time the webview is opened
        this.config = JSON.parse(document.getText()) as Config;

        // Setup webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview, this.config.name);
        webviewPanel.webview.onDidReceiveMessage(showErrorWrap(this.messageReceived.bind(this)));
        this.loadInputs(webviewPanel);
    }


    /**
     * @brief Return the html content for the webview
     * @param webview vscode.Webview object
     * @param name Name of the opened project
     * @returns The html as a string
    **/
    private getHtmlForWebview(webview: vscode.Webview, name: string) : string {
        // Get file paths
        const configEditorCss = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "configEditor.css"));
        const configEditorJs = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "configEditor.js"));
        
        const copyIcon = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "copy.png"));
        const helpIcon = webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "help.png"));

        // Use a nonce to whitelist which scripts can be run
		const nonce = randomString(32);

        return `<!DOCTYPE html>
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

    <div><textarea id="ignored_input" type="text" placeholder="Ignored files rules"></textarea></div>
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

    <div><textarea id="static_input" type="text" placeholder="Static files rules"></textarea></div>
    <div id="static_save_div">
        <button id="static_save" class="add_button">Save</button>
        <span id="static_saved">Saved</span>
    </div>


    <h2 class="help_h">Backup :</h2>
    <div class="help_div">
        <img id="b_help_icon" class="help_icon" src="${helpIcon}" />
    </div>
    <div class="help_div">
        <span id="b_help_text" class="help_text">In case anything goes wrong, your project files are backed up regularly. When a new backup is added, the oldest one is deleted. You can choose how many backups are maintained and how often they are added. ( Files are backed up on the machine of the current host of the Live Share session )</span>
    </div>

    <div id="backup">
        <span> Backup every</span>
        <input id="backup_frequency" type="text">
        <span> minutes</span>
    </div>

    <div id="backup">
        <span> Keep</span>
        <input id="backup_amount" type="text">
        <span> backups</span>
    </div>

    <div id="backup_path">
        <span id="backup_path_location"> Backups location :</span>
        <img id="copy_backup_button" class="icon" src="${copyIcon}" />
        <span id="backup_path_text"></span>
    </div>

    
    <script nonce="${nonce}" src="${configEditorJs}"></script>
</body>`;
    }


    /**
     * @brief Handle message from javascript
     * @param message The message that was received
    **/
    private async messageReceived(message: any) : Promise<void> {
        // Check instances
        if (!Project.instance) {
            throw new Error("Configuration action failed : not connected");
        }
        if (!GoogleDrive.instance) {
            throw new Error("Configuration action failed : not authenticated");
        }

        switch (message.type) {
            case "on_load":
                await this.addToMembers();
                await this.update(this.config, false);
                return;

            case "remove_member":
                await this.removeMember(message.index);
                break;
            
            case "remove_invite":
                await this.removeInvite(message.index);
                break;
            
            case "add_member":
                await this.addMember(message.email);
                break;
            
            case "global_sharing":
                if (message.checked) {
                    await this.enableGlobalSharing();
                }
                else {
                    await this.disableGlobalSharing();
                }
                break;
            
            case "save_ignored":
                this.config.filesConfig.ignoreRules = message.value;
                break;

            case "save_static":
                this.config.filesConfig.staticRules = message.value;
                break;
            
            case "backup_amount":
                this.config.filesConfig.maximumBackups = message.value;
                break;
            
            case "backup_frequency":
                this.config.filesConfig.backupFrequency = message.value;
                break;

            case "copy_link":
                await vscode.env.clipboard.writeText(this.config.shareConfig.public!.name);
                vscode.window.showInformationMessage("Link copied to clipboard");
                return;
            
            case "copy_backup_path":
                await vscode.env.clipboard.writeText(message.value);
                vscode.window.showInformationMessage("Path copied to clipboard");
                return;
        }

        // Save modifications
        await this.saveConfig();
    }


    /**
     * @brief Add the current user to the project members if not already done
    **/
    private async addToMembers() : Promise<void> {
        const email = await GoogleDrive.instance!.getEmail();
        if (this.config.shareConfig.members.every(m => m.name !== email) && 
            this.config.shareConfig.publicMembers.every(m => m !== email) && 
            this.config.shareConfig.owner !== email) {

            const inviteIndex = this.config.shareConfig.invites.findIndex(invite => invite.name === email);
            if (inviteIndex !== -1) {
                // Add the user to the members and remove it from the invites
                this.config.shareConfig.members.push(this.config.shareConfig.invites[inviteIndex]);
                this.config.shareConfig.invites.splice(inviteIndex, 1);
            }
            else {
                // Add the user to the public members
                this.config.shareConfig.publicMembers.push(email);
            }

            await this.saveConfig();
        }
    }


    /**
     * @brief Remove a member from the project
     * @param index Index of the member to remove
    **/
    private async removeMember(index: number) : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Removing member..." }, showErrorWrap(async () => {
            const member = this.config.shareConfig.members[index];
            this.config.shareConfig.members.splice(index, 1);
            await GoogleDrive.instance!.unshare(Project.instance!.driveProject, member);
            vscode.window.showInformationMessage(`User ${member.name} removed from project`);
        }));
    }


    /**
     * @brief Remove an invite from the project
     * @param index Index of the invite to remove
    **/
    private async removeInvite(index: number) : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Cancelling invite..." }, showErrorWrap(async () => {
            const member = this.config.shareConfig.invites[index];
            this.config.shareConfig.invites.splice(index, 1);
            await GoogleDrive.instance!.unshare(Project.instance!.driveProject, member);
            vscode.window.showInformationMessage(`User ${member.name} removed from project`);
        }));
    }


    /**
     * @brief Add a member to the project
     * @param email The email of the member to add
     * @returns 
    **/
    private async addMember(email: string) : Promise<void> {
        // Check if the email is already in the project
        if (this.config.shareConfig.members.some(m => m.name === email)) {
            throw new Error(`User ${email} is already in the project`);
        }
        if (this.config.shareConfig.invites.some(m => m.name === email)) {
            throw new Error(`User ${email} is already invited to the project`);
        }
        if (this.config.shareConfig.publicMembers.some(m => m === email)) {
            throw new Error(`User ${email} is already a global member of the project`);
        }
        if (email === this.config.shareConfig.owner) {
            throw new Error(`User ${email} is the owner of the project`);
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Inviting member..." }, showErrorWrap(async () => {
            const permission = await GoogleDrive.instance!.userShare(Project.instance!.driveProject, email);
            this.config.shareConfig.invites.push(permission);
            vscode.window.showInformationMessage(`User ${email} added to project`);
        }));
    }


    /**
     * @brief Enable global sharing for the project
    **/
    private async enableGlobalSharing() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Enabling global sharing..." }, showErrorWrap(async () => {
            const permission = await GoogleDrive.instance!.publicShare(Project.instance!.driveProject);
            this.config.shareConfig.public = permission;
            vscode.window.showInformationMessage("Global sharing enabled for project");
        }));
    }


    /**
     * @brief Disable global sharing for the project
    **/
    private async disableGlobalSharing() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disabling global sharing..." }, showErrorWrap(async () => {
            await GoogleDrive.instance!.unshare(Project.instance!.driveProject, this.config.shareConfig.public!);
            this.config.shareConfig.public = null;
            this.config.shareConfig.publicMembers = [];
            vscode.window.showInformationMessage("Global sharing disabled for project");
        }));
    }


    /**
     * @brief Save recent modification to the configuration file
    **/
    private async saveConfig() : Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(this.uri, new vscode.Range(0, 0, Number.MAX_VALUE, 0), JSON.stringify(this.config, null, 4));
        await vscode.workspace.applyEdit(edit);
        await vscode.workspace.save(this.uri);
    }


    /**
     * @brief Update all opened configuration editors
     * @param config Updated configuration (will be modified)
     * @param loadInputs Wether or not to load text inputs from config (default: true)
    **/
    public async update(config: Config, loadInputs: boolean = true) : Promise<void> {
        this.config = config;
        for (const webviewPanel of this.webviews) {
            await this.updateWebview(webviewPanel);
            if (loadInputs) {
                this.loadInputs(webviewPanel);
            }
        }
    }


    /**
     * @brief Update the webview content
     * @param webviewPanel Webview to update
    **/
    private async updateWebview(webviewPanel: vscode.WebviewPanel) : Promise<void> {
        // Get the image uris
        const crown = webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "crown.png"));
        const trash = webviewPanel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, "media", "trash.png"));

        // Update the webview
        webviewPanel.webview.postMessage({ 
            type: "update",
            config: this.config,
            email: await GoogleDrive.instance!.getEmail(),
            uris: {
                crown: crown.toString(),
                trash: trash.toString()
            },
            backupPath: Project.instance!.backupPath
        });
    }

    
    /**
     * @brief Load the static and ignore rule in the text inputs
     * @param webviewPanel Webview to update
    **/
    private loadInputs(webviewPanel: vscode.WebviewPanel) : void {
        webviewPanel.webview.postMessage({ 
            type: "load_inputs",
            ignored: this.config.filesConfig.ignoreRules,
            static: this.config.filesConfig.staticRules
        });
    }
}