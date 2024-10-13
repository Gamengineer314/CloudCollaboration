import * as vscode from "vscode";
import { GoogleDrive, DriveProject, Permission, ProjectState } from "./GoogleDrive";
import { LiveShare } from "./LiveShare";
import { FileSystem, FilesConfig } from "./FileSystem";
import { collaborationFolder, context, currentFolder } from "./extension";
import { fileUri, currentUri, collaborationUri, listFolder, currentListFolder, showErrorWrap, sleep, waitFor, collaborationName, log, logError, inCollaboration, Mutex } from "./util";
import { IgnoreStaticDecorationProvider } from "./FileDecoration";
import { Addon, addons } from "./Addons/Addon";
import { ConfigEditorProvider } from "./ConfigEditor";


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


export class Project {

    private static _instance : Project | undefined = undefined;
    public static get instance() : Project | undefined { return Project._instance; }
    private static _connecting : boolean = false;
    public static get connecting() : boolean { return Project._connecting; }

    private config : Config = Config.default;
    private addon : Addon | undefined = undefined;
    private mustUpload : boolean = false;
    private mutex : Mutex = new Mutex();
    private static clearingGarbage : boolean = false;

    private constructor(
        private project: DriveProject,
        private host: boolean,
        private state: ProjectState,
        private fileSystem: FileSystem
    ) {}

    public get driveProject() : DriveProject { return this.project; }
    public get storageFolder() : vscode.Uri { return this.fileSystem.storageFolder; }
    public get projectFolder() : vscode.Uri { return this.fileSystem.projectFolder; }
    public get backupPath() : string { return this.fileSystem.backupPath; }


    /**
     * @brief Activate Project class
    **/
    public static async activate() : Promise<void> {
        const windowState = context.globalState.get<WindowState>("windowState");
        log(JSON.stringify(windowState));
        if (windowState && windowState.project) { // Connecting to a project
            if (!windowState.continued) { // Continue connecting
                windowState.continued = true;
                await context.globalState.update("windowState", windowState);
                const instance = new Project(
                    windowState.project.project, 
                    windowState.project.host, 
                    windowState.project.state, 
                    FileSystem.copy(windowState.project.fileSystem, windowState.project.state)
                );
                vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(
                    async () => await Project.continueConnect(instance)
                ));
            }
            else { // Connection error -> come back to previous folder
                logError("Connection error");
                await context.globalState.update("windowState", undefined);
                vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(windowState.path), false);
            }
        }
        else if (windowState) {
            if (windowState.continued) {
                if (windowState.disconnected) { // Come back to previous folder
                    log("Come back");
                    await context.globalState.update("windowState", undefined);
                    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(windowState.path), false);
                }
                else if (!currentFolder || windowState.path === currentFolder.path) { // Host disconnected -> reconnect
                    if (currentFolder) { // Reconnect
                        await context.globalState.update("windowState", undefined);
                        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Reconnecting to project..." }, showErrorWrap(
                            async () => await Project.reconnect(windowState.userIndex)
                        ));
                    }
                    else { // Come back to previous folder
                        log("Reconnection");
                        vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(windowState.path), false);
                    }
                }
                else { // Come back to previous folder
                    logError("Not disconnected");
                    await context.globalState.update("windowState", undefined);
                }
            }
            else {
                logError("Invalid state");
                await context.globalState.update("windowState", undefined);
            }
        }

        // Clear remaining files
        if (currentFolder) {
            Project.clearingGarbage = true;
            (async () => {
                try {
                    await FileSystem.clearGarbage();
                }
                catch (error: any) {
                    logError(error.message);
                }
                finally {
                    Project.clearingGarbage = false;
                }
            })();
        }
    }


    /**
     * @brief Deactivate Project class
    **/
    public static async deactivate() : Promise<void> {
        if (Project.instance && Project.instance.host) {
            await Project.instance.mutex.lock();
            if (Project.instance.mustUpload) {
                Project.instance.mustUpload = false;
                await Project.instance.fileSystem.upload(Project.instance.config.filesConfig, true, true);
            }
            Project.instance.mutex.unlock();
        }
    }


    /**
     * @brief Create a new project in the current folder
    **/
    public static async createProject() : Promise<void> {
        // Check if folder is empty
        const files = await currentListFolder();
        if (files.length > 0) {
            throw new Error("Can't create project : folder must be empty");
        }

        // Check if authenticated
        if (!GoogleDrive.instance) {
            await GoogleDrive.authenticate();
            if (!GoogleDrive.instance) {
                throw new Error("Can't create project : not authenticated");
            }
        }

        // Ask for project name
        const name = await vscode.window.showInputBox({ prompt: "Project name" });
        if (!name) {
            throw new Error("Can't create project : no name provided");
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Creating project..." }, showErrorWrap(async () => {
            // Create project
            const project = await GoogleDrive.instance!.createProject(name);
            
            // Default files
            await vscode.workspace.fs.writeFile(currentUri(".collablaunch"), new TextEncoder().encode(JSON.stringify(project, null, 4)));
            await vscode.commands.executeCommand("vscode.openWith", currentUri(".collablaunch"), "cloud-collaboration.launchEditor");
            await vscode.workspace.fs.createDirectory(currentUri(".vscode"));
            await vscode.workspace.fs.writeFile(fileUri("settings.json", currentUri(".vscode")), new TextEncoder().encode(hostDefaultSettings));
            await vscode.workspace.fs.createDirectory(collaborationFolder);
            vscode.window.showInformationMessage("Project created successfully");
        }));
    }


    /**
     * @brief Join a project in the current folder
    **/
    public static async joinProject() : Promise<void> {
        // Check if folder is empty
        const files = await currentListFolder();
        if (files.length > 0) {
            throw new Error("Can't join project : folder must be empty");
        }

        // Check if authenticated
        if (!GoogleDrive.instance) {
            await GoogleDrive.authenticate();
            if (!GoogleDrive.instance) {
                throw new Error("Can't join project : not authenticated");
            }
        }

        await GoogleDrive.instance.pickProject(async (project) => {
            // Default files
            await vscode.workspace.fs.writeFile(currentUri(".collablaunch"), new TextEncoder().encode(JSON.stringify(project, null, 4)));
            vscode.commands.executeCommand("vscode.openWith", currentUri(".collablaunch"), "cloud-collaboration.launchEditor");
            await vscode.workspace.fs.createDirectory(currentUri(".vscode"));
            await vscode.workspace.fs.writeFile(currentUri(".vscode/settings.json"), new TextEncoder().encode(hostDefaultSettings));
            await vscode.workspace.fs.createDirectory(collaborationFolder);
            vscode.window.showInformationMessage("Project joined successfully");
        });
    }


    /**
     * @brief Connect to the project in the current folder
     * @param project Project (default: read it)
     * @param state Project state (default: fetch it)
    **/
    public static async connect(project: DriveProject | null = null, state: ProjectState | null = null) : Promise<void> {
        // Check if authenticated
        if (!GoogleDrive.instance) {
            await GoogleDrive.authenticate();
            if (!GoogleDrive.instance) {
                throw new Error("Connection failed : not authenticated");
            }
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(async () => {
            // Checks
            if (Project.instance || Project.connecting) {
                throw new Error("Connection failed : already connected");
            }
            Project._connecting = true;
            if (Project.clearingGarbage) {
                await waitFor(() => !Project.clearingGarbage);
            }

            log("Connect");
            try {
                // Get project information from .collablaunch file
                const driveProject = project || JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as DriveProject;
                const projectState = state || await GoogleDrive.instance!.getState(driveProject);
                let host = projectState.url === "";
                if (!host && !await LiveShare.checkSession(projectState.url)) {
                    host = true;
                    log("Override");
                }
                const fileSystem = await FileSystem.init(driveProject, projectState);
                const instance = new Project(driveProject, host, projectState, fileSystem);

                try {
                    if (host) {
                        // Connect
                        log("Host connect");
                        await Project._hostConnect(instance);
                    }
                    else {
                        // Save project state and join Live Share session (the extension will restart)
                        await LiveShare.activate();
                        await context.globalState.update("windowState", new WindowState(currentFolder.path, instance));
                        await LiveShare.instance!.joinSession(projectState.url);
                    }
                }
                catch (error: any) {
                    logError(error.message);
                    await Project._disconnect(instance);
                }
            }
            finally {
                Project._connecting = false;
            }
        }));
    }

    private static async _hostConnect(instance: Project) : Promise<void> {
        // Connect
        await LiveShare.activate();
        await instance.fileSystem.download();
        await LiveShare.instance!.createSession();
        instance.state.url = LiveShare.instance!.sessionUrl!;
        await GoogleDrive.instance!.setState(instance.project, instance.state);
        Project._instance = instance;
        await instance.fileSystem.startSync(true, instance.updateConfig.bind(instance));
        await instance.updateConfig(true);
        instance.addon = addons.get(instance.config.addon);
        instance.addon?.activate(instance.host);
        LiveShare.instance!.onSessionEnd = showErrorWrap(async () => await Project.disconnect());

        // Setup editor
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
        vscode.commands.executeCommand("workbench.action.terminal.killAll");
        vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);

        // Start upload
        instance.startUpload();
    }


    /**
     * @brief Continue connecting to the project as a guest after the extension restarted
     * @param instance Project instance
    **/
    private static async continueConnect(instance: Project) : Promise<void> {
        // Checks
        if (Project.instance || Project.connecting) {
            throw new Error("Connection failed : already connected");
        }
        Project._connecting = true;
        if (Project.clearingGarbage) {
            await waitFor(() => !Project.clearingGarbage);
        }

        try {
            // Connect
            log("Guest connect");
            await Project._guestConnect(instance);
        }
        catch (error: any) {
            logError(error.message);
            await Project._disconnect(instance);
        }
        finally {
            Project._connecting = false;
        }
    }

    private static async _guestConnect(instance: Project) : Promise<void> {
        // Wait until the Live Share session is ready
        await LiveShare.activate();
        await LiveShare.instance!.waitForSession();
        await vscode.commands.executeCommand("vscode.openWith", currentUri(".collablaunch"), "default");
        await waitFor(() => vscode.window.activeTextEditor !== undefined);

        // Update previous folder
        const windowState = context.globalState.get<WindowState>("windowState")!;
        windowState.project = undefined;
        LiveShare.instance!.onIndexChanged = (index) => {
            windowState.userIndex = index;
            context.globalState.update("windowState", windowState);
        };

        // Connect
        Project._instance = instance;
        await instance.fileSystem.startSync(false, instance.updateConfig.bind(instance));
        await instance.updateConfig(true);
        instance.addon = addons.get(instance.config.addon);
        instance.addon?.activate(instance.host);

        // Default settings
        for (const [key, value] of Object.entries(guestDefaultSettings)) {
            await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Workspace);
        }

        // Setup editor
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
        vscode.commands.executeCommand("workbench.action.terminal.killAll");
        vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
    }


    /**
     * @brief Reconnect to the project in the current folder
     * @param userIndex Previous session user index
    **/
    private static async reconnect(userIndex: number) : Promise<void> {
        // Check if not connected
        if (Project.instance || Project.connecting) {
            throw new Error("Connection failed : already connected");
        }
        Project._connecting = true;
        log("Reconnect");

        try {
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as DriveProject;
            let state: ProjectState;

            // Wait for previous host to disconnect
            let hostTime = Date.now();
            let overrideTime = Date.now() + 5_000 + 20_000 * (userIndex - 1);
            while (true) {
                state = await GoogleDrive.instance!.getState(project);
                if (state.url === "" && Date.now() >= hostTime) {
                    log("Previous disconnected");
                    break;
                }
                if (await LiveShare.checkSession(state.url)) {
                    log("New connected");
                    break;
                }
                if (Date.now() > overrideTime) {
                    log("Timeout");
                    state.url = "";
                    break;
                }
                await sleep(1_000);
            }

            // Connect
            Project._connecting = false;
            await Project.connect(project, state);
        }
        finally {
            Project._connecting = false;
        }
    }


    /**
     * @brief Disconnect from the project
    **/
    public static async disconnect() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disconnecting from project..." }, showErrorWrap(async () => {
            log("Disconnect");
            const instance = Project.instance!;
            instance.addon?.deactivate(instance.host);
            if (instance.host) {
                // Last upload
                Project._instance = undefined;
                await instance.stopUpload();
            }
            await Project._disconnect(instance);
        }));
    }


    /**
     * @brief Disconnect without synchronizing with Google Drive
     * @param instance Project instance
    **/
    private static async _disconnect(instance: Project) : Promise<void> {
        log("_disconnect");
        Project._instance = undefined;
        instance.mustUpload = false;
        instance.fileSystem.stopSync();
        LiveShare.instance!.onIndexChanged = () => {};
        LiveShare.instance!.onSessionEnd = () => {};
        if (!instance.host) {
            // Update window state
            const windowState = context.globalState.get<WindowState>("windowState");
            if (windowState) {
                windowState.disconnected = true;
                await context.globalState.update("windowState", windowState);
            }

            await instance.fileSystem.clear(instance.config.filesConfig, false);
        }
        await LiveShare.instance!.exitSession();
        if (instance.host) {
            await instance.fileSystem.clear(instance.config.filesConfig, true);

            // Setup editor
            vscode.commands.executeCommand("workbench.action.terminal.killAll");
            vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
        }
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
        // Check host
        await this.mutex.lock();
        if (await this.checkHost()) {
            this.mutex.unlock();
            return;
        }
        this.mutex.unlock();

        while (true) {
            // Wait 1 minute
            await sleep(60_000);

            // Check and upload
            await this.mutex.lock();
            if (!this.mustUpload) {
                this.mutex.unlock();
                break;
            }
            if (await this.checkHost()) {
                this.mutex.unlock();
                break;
            }
            try {
                await vscode.commands.executeCommand("workbench.action.files.saveAll");
                await this.fileSystem.upload(this.config.filesConfig);
            }
            catch (error: any) {
                logError(error.message);
            }
            this.mutex.unlock();
        }
    }


    /**
     * @brief Check if this user is the host on Google Drive, disconnect if it is not
     * @returns Wether or not the upload loop must be stopped
    **/
    private async checkHost() : Promise<boolean> {
        let currentUrl;
        let driveUrl;
        try {
            currentUrl = LiveShare.instance!.sessionUrl;
            driveUrl = (await GoogleDrive.instance!.getState(this.project)).url;
        }
        catch (error: any) {
            logError(error.message);
            return false;
        }

        if (currentUrl !== driveUrl) {
            logError(`Another user is the host for this project\n${currentUrl} != ${driveUrl}`);
            await Project._disconnect(this);
            await Project.connect();
            return true;
        }
        else {
            return false;
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
            await this.fileSystem.upload(this.config.filesConfig, true);
        }
        catch (error: any) { // Resume upload if error
            this.mutex.unlock();
            throw error;
        }
        this.mustUpload = false; // Stop upload
        this.mutex.unlock();
    }


    /**
     * @brief Download files of the project to another folder
    **/
    public async download() : Promise<void> {
        // Pick folder
        const folder = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.parse("file:///"), canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
        if (!folder || folder.length === 0) {
            throw new Error("Download failed : no folder selected");
        }

        // Check if folder is empty
        const files = await listFolder(folder[0]);
        if (files.length > 0) {
            throw new Error("Download failed : folder must be empty");
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Downloading project..." }, showErrorWrap(async () => {
            // Download files (without .collabconfig)
            await this.fileSystem.copyFiles(folder[0]);
            await vscode.workspace.fs.delete(fileUri(".collabconfig", folder[0]));
            vscode.window.showInformationMessage("Project downloaded successfully");
        }));
    }


    /**
     * @brief Open a terminal in the folder with a copy of the project
    **/
    public async newTerminal() : Promise<void> {
        await vscode.commands.executeCommand("workbench.action.terminal.newWithCwd", { cwd: this.fileSystem.projectFolder.fsPath });
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
        await this.fileSystem.addFiles(files, name);
        vscode.window.showInformationMessage("Files uploaded successfully");
    }


    /**
     * @brief Open a file in the project folder
     * @param name The name of the corresponding file in the collaboration folder
    **/
    public async openProjectFile(name: string) : Promise<void> {
        await this.fileSystem.openFile(name);
    }


    /**
     * @brief Update config from the .collabconfig file if it exists, create a default one otherwise
     * @param first Wether or not it is the first time the config is updated
    **/
    public async updateConfig(first: boolean = false) : Promise<void> {
        log("Config updated");

        // Read config
        const previousAddon = this.config.addon;
        const previousIgnore = this.config.filesConfig.ignoreRules;
        const previousStatic = this.config.filesConfig.staticRules;
        try {
            this.config = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(collaborationUri(".collabconfig")))) as Config;
        }
        catch {
            log("Create config");
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as DriveProject;
            this.config = new Config(project.name, new FilesConfig(), new ShareConfig(await GoogleDrive.instance!.getEmail()), "Unspecified");
            await vscode.workspace.fs.writeFile(collaborationUri(".collabconfig"), new TextEncoder().encode(JSON.stringify(this.config, null, 4)));
            vscode.window.showInformationMessage("Project configuration file created");
        }

        // Update configuration editor
        await ConfigEditorProvider.instance?.update(structuredClone(this.config));

        // Update file decorations
        if (this.config.filesConfig.ignoreRules.length !== previousIgnore.length ||
            this.config.filesConfig.staticRules.length !== previousStatic.length ||
            this.config.filesConfig.ignoreRules.some((value, index) => value !== previousIgnore[index]) || 
            this.config.filesConfig.staticRules.some((value, index) => value !== previousStatic[index])) {
            await IgnoreStaticDecorationProvider.instance?.update(this.config.filesConfig);
        }

        // Update addon
        if (!first && this.config.addon !== previousAddon) {
            if (this.addon) {
                this.addon.deactivate(this.host);
            }
            this.addon = addons.get(this.config.addon);
            log("Addon changed " + this.config.addon);
            if (this.addon) {
                this.addon.activate(this.host);
                if (this.host) {
                    this.addon.defaultConfig(this.config);
                    await vscode.workspace.fs.writeFile(collaborationUri(".collabconfig"), new TextEncoder().encode(JSON.stringify(this.config, null, 4)));
                }
            }
        }
    }

}



export class ShareConfig {
    public invites: Permission[] = [];
    public members: Permission[] = [];
    public public: Permission | null = null;
    public publicMembers: string[] = [];

    public constructor(public owner: string) {}
}



export class Config {
    public constructor(
        public name: string, 
        public filesConfig: FilesConfig,
        public shareConfig: ShareConfig,
        public addon: string
    ) {}

    public static default : Config = new Config("", new FilesConfig(), new ShareConfig(""), "");
}



class WindowState {
    public continued: boolean = false;
    public disconnected: boolean = false;
    public userIndex: number = 0;
    public constructor(
        public path: string,
        public project: Project | undefined = undefined
    ) {}
}