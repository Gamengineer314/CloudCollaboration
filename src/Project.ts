import * as vscode from "vscode";
import { LiveShare } from "./LiveShare";
import { FileSynchronizer } from "./FileSynchronizer";
import { currentFolder, context, projectFolder } from "./extension";
import { showErrorWrap, sleep, currentName, log, logError, inCurrent, Mutex, currentListFolder, projectUri, projectListFolder, currentUri, deleteFiles } from "./util";
import { IncomingMessage, Server, ServerResponse, createServer } from "http";


const hostDefaultSettings = `{
    "liveshare.autoShareTerminals": false,
    "files.saveConflictResolution": "overwriteFileOnDisk",
    "terminal.integrated.defaultProfile.linux": "Cloud Collaboration",
    "terminal.integrated.defaultProfile.windows": "Cloud Collaboration",
    "terminal.integrated.defaultProfile.osx": "Cloud Collaboration"
}`;

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
    private static connecting : boolean = false;
    private static server : Server | undefined = undefined;

    private mustUpload : boolean = false;
    private mutex : Mutex = new Mutex();

    private constructor(
        private host: boolean,
        private fileSynchronizer: FileSynchronizer,
        private liveShare : LiveShare
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

        
        if (windowState) {
            log("Window state: " + windowState);
            if (!windowState.connected) { // Connecting to a project
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
                if (windowState.disconnected) { // Come back to previous folder
                    log("Come back");
                    await context.globalState.update("windowState", undefined);
                    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(windowState.path), false);
                }
                else if (!currentFolder) { // Host disconnected -> come back to previous folder
                    log("Reconnection");
                    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(windowState.path), false);
                }
                else if (windowState.path === currentFolder.path) { // Reconnect after coming back
                    await context.globalState.update("windowState", undefined);
                    vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Reconnecting to project..." }, showErrorWrap(
                        async () => {
                            await Project.reconnect(windowState.userIndex);
                        }
                    ));
                }
                else {
                    logError("Not disconnected");
                    await context.globalState.update("windowState", undefined);
                }
            }
        }
        else {
            log("No state");
        }
 
        // Check if project folder exists
        if (await Project.hasProject()) {
            log("Has project");
            vscode.commands.executeCommand("setContext", "cloud-collaboration.hasProject", true);

            // Clear garbage files if any
            const files = await currentListFolder();
            if (files.length > 0) {
                await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disconnecting from project..." }, showErrorWrap(async () => {
                    log("Clear garbage");
                    await deleteFiles(files);
                }));
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
                // TODO: upload
            }
            Project.instance.mutex.unlock();
        }
    }


    /**
     * @brief Join a project in the current folder
    **/
    public static async joinProject() : Promise<void> {
        // Check if folders are empty
        const currentFiles = await currentListFolder();
        if (currentFiles.length > 0) {
            throw new Error("Can't join project : workspace must be empty");
        }
        if (await Project.hasProject()) {
            throw new Error("Can't join project : a project already exists in this workspace");
        }

        // TODO: inputs

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Joining project..." }, showErrorWrap(async () => {
            log("Join project");
            // TODO: join git project
            await vscode.workspace.fs.createDirectory(projectUri(".vscode"));
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(projectFolder, ".vscode", "settings.json"), new TextEncoder().encode(hostDefaultSettings));
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
                const url = ""; // TODO: get URL
                let host = url === "";
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
                        await Project.hostConnect();
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

    private static async hostConnect() : Promise<void> {
        // Create instance
        const liveShare = await LiveShare.get();
        const synchronizer = new FileSynchronizer();
        const instance = new Project(true, synchronizer, liveShare);
        Project._instance = instance;

        // Connect
        await liveShare.createSession();
        const url = liveShare.sessionUrl!;
        log("Url " + url);
        // TODO: set URL
        liveShare.setCallbacks(undefined, showErrorWrap(async () => await Project.disconnect()));
        await synchronizer.loadCurrent();
        await synchronizer.startSync(true);
        instance.startUpload();

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
            await Project.guestConnect();
        }
        catch (error: any) {
            logError(error.message);
            await Project._disconnect();
        }
        finally {
            Project.connecting = false;
        }
    }

    private static async guestConnect() : Promise<void> {
        // Create instance
        const liveShare = await LiveShare.get();
        const synchronizer = new FileSynchronizer();
        const instance = new Project(false, synchronizer, liveShare);
        Project._instance = instance;

        // Wait until the Live Share session is ready
        await liveShare.waitForSession();
        // TODO: wait until files appear

        // Update previous folder
        const windowState = context.globalState.get<WindowState>("windowState")!;
        liveShare.setCallbacks((index) => {
            windowState.userIndex = index;
            context.globalState.update("windowState", windowState);
        }, undefined);

        // Connect
        await synchronizer.loadProject();
        await synchronizer.startSync(false);

        // Default settings
        for (const [key, value] of Object.entries(guestDefaultSettings)) {
            await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Workspace);
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
            let hostTime = Date.now() + 20_000 * (userIndex - 1);
            let overrideTime = Date.now() + 5_000 + 20_000 * (userIndex - 1);
            while (true) {
                let url = "";
                // TODO: get URL
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
                    url = "";
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
     * @brief Disconnect from the project
    **/
    public static async disconnect() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disconnecting from project..." }, showErrorWrap(async () => {
            log("Disconnect");
            const instance = Project.instance!;
            if (instance.host) {
                // Last upload
                await instance.stopUpload();
            }
            await Project._disconnect();
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
                await instance.fileSynchronizer.clearProject();

                // Update window state
                const windowState = context.globalState.get<WindowState>("windowState");
                if (windowState) {
                    windowState.disconnected = true;
                    await context.globalState.update("windowState", windowState);
                }
            }
            await instance.liveShare.exitSession();
            if (instance.host) {
                await instance.fileSynchronizer.clearCurrent();

                // Setup editor
                vscode.commands.executeCommand("workbench.action.closeAllEditors");
                vscode.commands.executeCommand("workbench.action.terminal.killAll");
                vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
            }
        }
        Project.disconnectedWindow();
    }

    
    /**
     * @brief Start uploading files regularly to Google Drive
    **/
    private startUpload() : void {
        log("Start upload");
        this.mustUpload = true;
        this.uploadLoop();
    }


    /**
     * @brief Upload files regularly to Google Drive
    **/
    private async uploadLoop() : Promise<void> {
        while (true) {
            // Wait 10 minutes
            // TODO: add setting
            await sleep(600_000);

            // Upload
            await this.mutex.lock();
            if (!this.mustUpload) {
                this.mutex.unlock();
                break;
            }
            try {
                await vscode.commands.executeCommand("workbench.action.files.saveAll");
                await sleep(1000);
                // TODO: upload and check host
            }
            catch (error: any) {
                logError(error.message);
            }
            this.mutex.unlock();
        }
    }


    /**
     * @brief Stop uploading files regularly to Google Drive
    **/
    private async stopUpload() : Promise<void> {
        log("Stop upload");
        await this.mutex.lock();
        if (!this.mustUpload) {
            this.mutex.unlock();
            throw new Error("Already disconnected");
        }
        try {
            await vscode.commands.executeCommand("workbench.action.files.saveAll");
            await sleep(1000);
            // TODO: upload
        }
        catch (error: any) { // Resume upload if error
            this.mutex.unlock();
            throw error;
        }
        this.mustUpload = false; // Stop upload
        this.mutex.unlock();
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
        if (uri && inCurrent(uri)) {
            name = currentName(uri);
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
     * @brief Open a file in the project folder
     * @param name The name of the corresponding file in the collaboration folder
    **/
    public async openProjectFile(name: string) : Promise<void> {
        await vscode.commands.executeCommand("vscode.open", projectUri(this.fileSynchronizer.toProjectName(name)));
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

    
    /**
     * @brief Check if the project folder exists
    **/
    public static async hasProject() : Promise<boolean> {
        try {
            await vscode.workspace.fs.stat(projectFolder);
            return true;
        }
        catch {
            return false;
        }
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