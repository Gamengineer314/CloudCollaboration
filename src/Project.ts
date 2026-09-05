import * as vscode from "vscode";
import { LiveShare } from "./LiveShare";
import { Git } from "./Git";
import { FileSynchronizer } from "./FileSynchronizer";
import { currentFolder, collaborationFolder, projectFolder, context, storageFolder } from "./extension";
import { showErrorWrap, sleep, collaborationName, inCollaboration, log, logError, Mutex, exists } from "./util";
import { IncomingMessage, Server, ServerResponse, createServer } from "http";
import { homedir } from "os";


const hostDefaultSettings = {
    "liveshare.autoShareTerminals": false,
    "files.saveConflictResolution": "overwriteFileOnDisk",
    "terminal.integrated.defaultProfile.linux": "Cloud Collaboration",
    "terminal.integrated.defaultProfile.windows": "Cloud Collaboration",
    "terminal.integrated.defaultProfile.osx": "Cloud Collaboration"
};

const guestDefaultSettings = {
    "terminal.integrated.defaultProfile.linux": "Cloud Collaboration",
    "terminal.integrated.defaultProfile.windows": "Cloud Collaboration",
    "terminal.integrated.defaultProfile.osx": "Cloud Collaboration"
};

const PORT = 18235;
const LOCALHOST = "http://localhost:" + PORT;


export class Project {

    private static _instance : Project | undefined = undefined;
    public static get instance() : Project | undefined { return Project._instance; }
    private static _hasProject : boolean = false;
    public static get hasProject() : boolean { return Project._hasProject; }

    private static connecting : boolean = false;
    private static server : Server | undefined = undefined;
    private static urlPath : vscode.Uri;

    private mustUpload : boolean = false;
    private mutex : Mutex = new Mutex();

    private constructor(
        private readonly host: boolean,
        private readonly fileSynchronizer: FileSynchronizer,
        private readonly liveShare: LiveShare,
        private readonly git: Git | undefined
    ) {}


    /**
     * @brief Activate Project class
    **/
    public static async activate() : Promise<void> {
        let windowState = context.globalState.get<WindowState>("windowState");

        // Check if other window is open
        if (windowState && await Project.checkWindow()) {
            log("Other window");
            windowState = undefined;
        }
        
        Project.urlPath = vscode.Uri.joinPath(storageFolder, "liveShareURL.txt");
        if (windowState) {
            log("Window state: " + JSON.stringify(windowState));
            if (!windowState.connected) { // Connecting to a project
                Project._hasProject = true;
                windowState.connected = true;
                await context.globalState.update("windowState", windowState);
                vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(
                    async () => {
                        Project.connectedWindow();
                        await Project.continueConnect();
                    }
                ));
            }
            else {
                if (!windowState.disconnected && !currentFolder) { // Host disconnected -> come back to previous folder
                    log("Reconnection");
                    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(windowState.path), false);
                }
                else if (!windowState.disconnected && windowState.path === currentFolder.path) { // Reconnect after coming back
                    await context.globalState.update("windowState", undefined);
                    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Reconnecting to project..." }, showErrorWrap(
                        async () => {
                            await Project.reconnect(windowState.userIndex);
                        }
                    ));
                }
                else {
                    log("Come back");
                    await context.globalState.update("windowState", undefined);
                    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(windowState.path), false);
                }
            }
        }
        else {
            log("No state");
            
            if (await exists(projectFolder)) {
                log("Has project");
                Project._hasProject = true;
                vscode.commands.executeCommand("setContext", "cloud-collaboration.hasProject", true);
                if (await exists(collaborationFolder)) {
                    log("Clear garbage");
                    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disconnecting from project..." }, showErrorWrap(Project.hostClear));
                    vscode.commands.executeCommand("workbench.action.closeAllEditors");
                    vscode.commands.executeCommand("workbench.action.terminal.killAll");
                }
            }
        }
    }


    /**
     * @brief Deactivate Project class
    **/
    public static async deactivate() : Promise<void> {
        Project.disconnectedWindow();
        if (Project.instance && Project.instance.host) {
            await Project.instance.mutex.lock();
            if (Project.instance.mustUpload) {
                Project.instance.mustUpload = false;
                await Project.instance._upload();
            }
            Project.instance.mutex.unlock();
        }
    }


    /**
     * @brief Join a project in the current folder
    **/
    public static async joinProject() : Promise<void> {
        // Check if folders are empty
        const currentFiles = await vscode.workspace.fs.readDirectory(currentFolder);
        if (currentFiles.length > 0) {
            throw new Error("Can't join project : workspace must be empty");
        }
        if (Project._hasProject) {
            throw new Error("Can't join project : a project already exists in this workspace");
        }

        // Ask for the URL
        const url = await vscode.window.showInputBox({
            title: "Git remote URL",
            prompt: "Enter the HTTP or SSH URL of the git remote, for example a GitHub repository",
            placeHolder: "https://github.com/<Name>/<Repo>.git OR git@github.com:<Name>/<Repo>.git",
            ignoreFocusOut: true
        });
        if (!url) {
            throw new Error("Join failed : no URL provided");
        }
        
        // Ask for authentication information
        const protocol = Git.detectProtocol(url);
        let config: [string, string][];
        if (protocol === "http") {
            const username = await vscode.window.showInputBox({
                title: "Git remote HTTP username",
                prompt: "Enter your username to authenticate to the Git remote over HTTP",
                ignoreFocusOut: true
            });
            if (username === undefined) {
                throw new Error("Join failed : no username provided");
            }
            const password = await vscode.window.showInputBox({
                title: "Git remote HTTP password",
                prompt: "Enter your password or token to authenticate to the Git remote over HTTP",
                ignoreFocusOut: true
            });
            if (password === undefined) {
                throw new Error("Join failed : no password provided");
            }
            config = await Git.getHTTPConfig(username, password);
        }
        else {
            const sshDir = vscode.Uri.joinPath(vscode.Uri.file(homedir()), ".ssh");
            const keys = (await vscode.workspace.fs.readDirectory(sshDir))
                .filter((f) => f[0].endsWith('.pub'))
                .map(f => vscode.Uri.joinPath(sshDir, f[0].substring(0, f[0].length - 4)).fsPath);
            let key = await vscode.window.showQuickPick(keys, {
                title: "Git remote SSH key",
                prompt: "Enter the path to your SSH key to authenticate to the Git remote over SSH",
                ignoreFocusOut: true
            });
            if (!key) {
                throw new Error("Join failed : no key provided");
            }
            config = Git.getSSHConfig(key);
        }

        // Ask for author information
        const globalAuthor = await Git.getGlobalAuthor();
        const name = await vscode.window.showInputBox({
            title: "Author name",
            prompt: "Enter your name to author Git commits",
            value: globalAuthor.name || "",
            ignoreFocusOut: true
        });
        if (!name) {
            throw new Error("Join failed : no name provided");
        }
        const email = await vscode.window.showInputBox({
            title: "Author email",
            prompt: "Enter your email to author Git commits",
            value: globalAuthor.email || "",
            ignoreFocusOut: true
        });
        if (!email) {
            throw new Error("Join failed : no email provided");
        }
        config = [...config, ...Git.getAuthorConfig(name, email)];

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Joining project..." }, showErrorWrap(async () => {
            log("Join project");
            await Git.clone(url, config);
            await vscode.workspace.fs.createDirectory(projectFolder);
            await Project.setUrl("");
            Project._hasProject = true;
            vscode.commands.executeCommand("setContext", "cloud-collaboration.hasProject", true);
            vscode.window.showInformationMessage("Project joined successfully");
        }));
    }


    /**
     * @brief Remove the project in the current folder
    **/
    public static async removeProject() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Removing project..." }, showErrorWrap(async () => {
            log("Remove project");
            await vscode.workspace.fs.delete(projectFolder, { recursive: true });
            await vscode.workspace.fs.delete(vscode.Uri.joinPath(storageFolder, ".git"), { recursive: true });
            await vscode.workspace.fs.delete(Project.urlPath);
            Project._hasProject = false;
            vscode.commands.executeCommand("setContext", "cloud-collaboration.hasProject", false);
            vscode.window.showInformationMessage("Project removed successfully");
        }));
    }


    /**
     * @brief Connect to the project in the current folder
     * @param project Project (default: read it)
     * @param state Project state (default: fetch it)
    **/
    public static async connect() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(async () => {
            // Checks
            if (Project.instance || Project.connecting) {
                throw new Error("Connection failed : already connected");
            }
            if (await Project.checkWindow()) {
                throw new Error("Connection failed : multiple windows");
            }

            log("Connect");
            Project.connecting = true;
            try {
                // Get project information
                const git = await Git.get();
                await git.pull();
                const url = await Project.getUrl();
                let host = false;
                if (!host) {
                    log("Url " + url);
                    if (!await LiveShare.checkSession(url)) {
                        host = true;
                        log("Override");
                    }
                }

                if (host) {
                    try {
                        // Connect
                        log("Host connect");
                        Project.connectedWindow();
                        Project._instance = new Project(true, new FileSynchronizer(), await LiveShare.get(), git);
                        Project._instance.hostConnect();
                    }
                    catch (error: any) {
                        logError(error.message);
                        await Project._disconnect();
                    }
                }
                else {
                    const liveShare = await LiveShare.get();
                    try {
                        // Save project state and join Live Share session (the extension will restart)
                        await context.globalState.update("windowState", new WindowState(currentFolder.path));
                        await liveShare.joinSession(url);
                    }
                    catch (error: any) {
                        logError(error.message);
                        liveShare.exitSession();
                        await context.globalState.update("windowState", undefined);
                    }
                }
            }
            finally {
                Project.connecting = false;
            }
        }));
    }


    private async hostConnect() : Promise<void> {
        // Connect
        await this.liveShare.createSession();
        const url = this.liveShare.sessionUrl!;
        log("Url " + url);
        await Project.setUrl(url);
        await this._upload();
        this.liveShare.setCallbacks(undefined, showErrorWrap(Project.disconnect.bind(undefined, true)));
        await this.fileSynchronizer.loadCollaboration();
        await this.fileSynchronizer.startSync(true);
        this.mustUpload = true;
        this.uploadLoop();

        // Default settings
        const configuration = vscode.workspace.getConfiguration();
        for (const [key, value] of Object.entries(hostDefaultSettings)) {
            await configuration.update(key, value, vscode.ConfigurationTarget.Workspace);
        }

        // Setup editor
        vscode.commands.executeCommand("workbench.action.closeAllEditors");
        vscode.commands.executeCommand("workbench.action.terminal.killAll");
        vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
    }


    /**
     * @brief Continue connecting to the project as a guest after the extension restarted
    **/
    private static async continueConnect() : Promise<void> {
        if (Project.instance || Project.connecting) {
            throw new Error("Connection failed : already connected");
        }

        Project.connecting = true;
        try {
            // Connect
            log("Guest connect");
            Project._instance = new Project(false, new FileSynchronizer(), await LiveShare.get(), undefined);
            Project._instance.guestConnect();
        }
        catch (error: any) {
            logError(error.message);
            await Project._disconnect();
        }
        finally {
            Project.connecting = false;
        }
    }


    private async guestConnect() : Promise<void> {
        // Wait until the Live Share session is ready
        await this.liveShare.waitForSession();

        // Update previous folder
        const windowState = context.globalState.get<WindowState>("windowState")!;
        this.liveShare.setCallbacks(showErrorWrap((index) => {
            windowState.userIndex = index;
            context.globalState.update("windowState", windowState);
        }), showErrorWrap(() => {
            windowState.disconnected = true;
            context.globalState.update("windowState", windowState);
        }));

        // Connect
        await this.fileSynchronizer.loadProject();
        await this.fileSynchronizer.startSync(false);

        // Default settings
        const configuration = vscode.workspace.getConfiguration();
        for (const [key, value] of Object.entries(guestDefaultSettings)) {
            await configuration.update(key, value, vscode.ConfigurationTarget.Workspace);
        }

        // Setup editor
        vscode.commands.executeCommand("workbench.action.closeAllEditors");
        vscode.commands.executeCommand("workbench.action.terminal.killAll");
        vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
    }


    /**
     * @brief Reconnect to the project in the current folder
     * @param userIndex Previous session user index
    **/
    private static async reconnect(userIndex: number) : Promise<void> {
        if (Project.instance || Project.connecting) {
            throw new Error("Connection failed : already connected");
        }

        log("Reconnect");
        Project.connecting = true;
        try {
            // Wait for previous host to disconnect
            const git = await Git.get();
            let hostTime = Date.now() + 20_000 * (userIndex - 1);
            let overrideTime = Date.now() + 5_000 + 20_000 * (userIndex - 1);
            while (true) {
                await git.pull();
                let url = await Project.getUrl();
                if (url === "" && Date.now() >= hostTime) {
                    log("Previous disconnected");
                    break;
                }
                if (await LiveShare.checkSession(url)) {
                    log("New connected");
                    break;
                }
                if (Date.now() > overrideTime) {
                    log("Timeout");
                    break;
                }
                await sleep(1_000);
            }

            Project.connecting = false;
            await Project.connect();
        }
        catch {
            Project.connecting = false;
        }
    }


    /**
     * @brief Get the Live Share URL
    **/
    private static async getUrl() : Promise<string> {
        return new TextDecoder().decode(await vscode.workspace.fs.readFile(Project.urlPath));
    }

    /**
     * @brief Get the Live Share URL
    **/
    private static async setUrl(url: string) : Promise<void> {
        await vscode.workspace.fs.writeFile(Project.urlPath, new TextEncoder().encode(url));
    }


    /**
     * @brief Disconnect from the project
     * @param force Whether to disconnect even if the last upload fails
    **/
    public static async disconnect(force: boolean) : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disconnecting from project..." }, showErrorWrap(async () => {
            log("Disconnect");
            const instance = Project.instance!;
            if (instance.host) {
                await Project.setUrl("");
                try {
                    await instance.upload();
                }
                catch (error: any) {
                    logError(error.message);
                    if (!force) { // Cancel disconnection
                        await Project.setUrl(instance.liveShare.sessionUrl!);
                        return;
                    }
                }
            }
            await Project._disconnect();
            if (instance.host) {
                // Setup editor
                vscode.commands.executeCommand("workbench.action.closeAllEditors");
                vscode.commands.executeCommand("workbench.action.terminal.killAll");
                vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
            }
        }));
    }

    private static async _disconnect() : Promise<void> {
        log("_disconnect");
        const instance = Project._instance;
        if (instance) {
            Project._instance = undefined;
            instance.mustUpload = false;
            instance.fileSynchronizer.stopSync();
            instance.liveShare.disposeCallbacks();
            if (!instance.host) {
                await vscode.workspace.fs.delete(projectFolder, { recursive: true });

                // Update window state
                const windowState = context.globalState.get<WindowState>("windowState");
                if (windowState) {
                    windowState.disconnected = true;
                    await context.globalState.update("windowState", windowState);
                }
            }
            await instance.liveShare.exitSession();
            if (instance.host) {
                await Project.hostClear();
            }
        }
        Project.disconnectedWindow();
    }


    /**
     * @brief Clear the files in the collaboration folder after being host
    **/
    private static async hostClear() : Promise<void> {
        await vscode.workspace.fs.delete(collaborationFolder, { recursive: true });
        const configuration = vscode.workspace.getConfiguration();
        for (const key of Object.keys(hostDefaultSettings)) {
            await configuration.update(key, undefined, vscode.ConfigurationTarget.Workspace);
        }
    }


    /**
     * @brief Upload files regularly to Google Drive
    **/
    private async uploadLoop() : Promise<void> {
        while (this.mustUpload) {
            // Wait 10 minutes
            // TODO: add setting
            await sleep(60_000);
            try {
                await this.upload();
            }
            catch (error: any) {
                logError(error.message);
            }
        }
    }


    /**
     * @brief Upload files
    **/
    private async upload() : Promise<void> {
        await this.mutex.lock();
        if (!this.mustUpload) {
            this.mutex.unlock();
            return;
        }
        log("Upload");
        try {
            await vscode.commands.executeCommand("workbench.action.files.saveAll");
            await sleep(1000);
            await this._upload();
        }
        finally {
            this.mutex.unlock();
        }
    }


    private async _upload() : Promise<void> {
        await this.git!.commit(".", "Upload");
        await this.git!.push();
    }


    /**
     * @brief Prompt the user to select files to add to the project
     * @param uri The URI of the folder to add the files to
    **/
    public async uploadFiles(uri: vscode.Uri | null = null) : Promise<void> {
        // Prompt user to select files
        const files = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.parse("file:///"), title: "Select files to upload", canSelectMany: true });
        if (!files) {
            throw new Error("Upload failed : no files selected");
        }

        // Get the name of the folder
        let name: string;
        if (uri && inCollaboration(uri)) {
            name = collaborationName(uri);
            const stat = await vscode.workspace.fs.stat(uri);
            if (stat.type !== vscode.FileType.Directory) {
                name = name.substring(0, name.lastIndexOf("/"));
            }
        }
        else {
            name = "/";
        }

        // Upload files
        for (const file of files) {
            const dest = vscode.Uri.joinPath(projectFolder, name, file.path.substring(file.path.lastIndexOf("/") + 1));
            await vscode.workspace.fs.copy(file, dest, { overwrite: true});
        }
        vscode.window.showInformationMessage("Files uploaded successfully");
    }


    /**
     * @brief Check if another window is connected to a project
    **/
    private static async checkWindow() : Promise<boolean> {
        let response;
        try {
            response = await fetch(LOCALHOST + "/ping");
        }
        catch {
            return false;
        }
        if (response.ok) {
            return true;
        }
        return false;
    }


    /**
     * @brief Set the current window as connected
    **/
    private static connectedWindow() : void {
        Project.server = createServer(showErrorWrap((request: IncomingMessage, response: ServerResponse) => {
            if (request.url === "/ping") {
                response.writeHead(200, { "Content-Type": "text/plain" });
                response.end("pong");
            }
        }));
        Project.server.listen(PORT);
    }


    /**
     * @brief Set the current window as disconnected
    **/
    private static disconnectedWindow() : void {
        Project.server?.close();
    }

}



class WindowState {
    public connected: boolean = false;
    public disconnected: boolean = false;
    public userIndex: number = 0;
    public constructor(
        public path: string,
    ) {}
}