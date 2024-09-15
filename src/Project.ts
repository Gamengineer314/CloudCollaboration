import * as vscode from "vscode";
import { GoogleDrive, DriveProject, Permission, ProjectState } from "./GoogleDrive";
import { LiveShare } from "./LiveShare";
import { FileSystem, FilesConfig } from "./FileSystem";
import { collaborationFolder, context, currentFolder } from "./extension";
import { fileUri, currentUri, collaborationUri, listFolder, currentListFolder, showErrorWrap, sleep, waitFor, collaborationName } from "./util";
import { IgnoreStaticDecorationProvider } from "./FileDecoration";


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

    private uploading : boolean = false;
    private mustUpload : boolean | undefined = undefined;

    private constructor(
        private project: DriveProject,
        private host: boolean,
        private state: ProjectState,
        private fileSystem: FileSystem
    ) {}

    public get driveProject() : DriveProject { return this.project; }
    public get projectPath() : string { return this.fileSystem.projectPath; }
    public get backupPath() : string { return this.fileSystem.backupPath; }


    /**
     * @brief Activate Project class
    **/
    public static async activate() : Promise<void> {
        // Restore project state after a restart for joining a Live Share session
        const project = context.globalState.get<Project>("projectState");
        const previousFolder = context.globalState.get<PreviousFolder>("previousFolder");
        console.log(JSON.stringify(previousFolder));
        if (project && previousFolder) { // Connected to a project
            const instance = new Project(project.project, project.host, project.state, FileSystem.copy(project.fileSystem));
            if (!previousFolder.active) { // Continue connecting
                previousFolder.active = true;
                context.globalState.update("previousFolder", previousFolder);
                vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(
                    async () => await Project.guestConnect(instance)
                ));
            }
            else {
                if (!previousFolder.connected) { // Error -> connect as host
                    if (currentFolder && previousFolder.path === currentFolder.path) { // Connect
                        context.globalState.update("projectState", undefined);
                        context.globalState.update("previousFolder", new PreviousFolder(currentFolder.path));
                        instance.host = true;
                        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(
                            async () => await Project.hostConnect(instance)
                        ));
                    }
                    else { // Come back to previous folder
                        console.log("Connection error");
                        vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(previousFolder.path), false);
                    }
                }
                else { // Invalid state
                    vscode.window.showErrorMessage("Project activation failed : invalid state");
                    console.error(new Error("Project activation failed : invalid state"));
                    context.globalState.update("projectState", undefined);
                    context.globalState.update("previousFolder", undefined);
                }
            }
        }
        else {
            if (project) { // Invalid state
                vscode.window.showErrorMessage("Project activation failed : invalid state");
                console.error(new Error("Project activation failed : invalid state"));
            }
            else if (previousFolder && previousFolder.active) { // Come back to previous folder
                if (previousFolder.disconnected) {
                    context.globalState.update("previousFolder", undefined);
                    vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(previousFolder.path), false);
                }
                else { // Host disconnected -> reconnect
                    if (currentFolder && previousFolder.path === currentFolder.path) { // Reconnect
                        context.globalState.update("previousFolder", new PreviousFolder(currentFolder.path));
                        vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Reconnecting to project..." }, showErrorWrap(
                            async () => await Project.reconnect(previousFolder.sessionUrl, previousFolder.userIndex)
                        ));
                    }
                    else { // Come back to previous folder
                        console.log("Reconnection");
                        vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(previousFolder.path), false);
                    }
                }
            }
            else if (currentFolder) { // Create previous folder
                context.globalState.update("previousFolder", new PreviousFolder(currentFolder.path));
            }
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
            await vscode.workspace.fs.createDirectory(collaborationFolder);
            await vscode.workspace.fs.createDirectory(currentUri(".vscode"));
            await vscode.workspace.fs.writeFile(currentUri(".vscode/settings.json"), new TextEncoder().encode(hostDefaultSettings));
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
            await vscode.commands.executeCommand("vscode.openWith", currentUri(".collablaunch"), "cloud-collaboration.launchEditor");
            await vscode.workspace.fs.createDirectory(collaborationFolder);
            await vscode.workspace.fs.createDirectory(currentUri(".vscode"));
            await vscode.workspace.fs.writeFile(currentUri(".vscode/settings.json"), new TextEncoder().encode(hostDefaultSettings));
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
            // Check if not connected
            if (Project.instance || Project.connecting) {
                throw new Error("Connection failed : already connected");
            }
            Project._connecting = true;
            console.log("Connect");

            try {
                // Get project information from .collablaunch file
                const driveProject = project || JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as DriveProject;
                const projectState = state || await GoogleDrive.instance!.getState(driveProject);
                const host = projectState.url === "";
                const fileSystem = await FileSystem.init(driveProject, projectState);
                const instance = new Project(driveProject, host, projectState, fileSystem);

                try {
                    if (host) {
                        // Connect
                        await Project._hostConnect(instance);
                    }
                    else {
                        // Save project state and join Live Share session (the extension will restart)
                        await LiveShare.activate();
                        await context.globalState.update("projectState", instance);
                        await LiveShare.instance!.joinSession(projectState.url);
                    }
                }
                catch (error: any) {
                    vscode.window.showErrorMessage(error.message);
                    console.error(error);
                    await Project._disconnect(instance);
                }
            }
            finally {
                Project._connecting = false;
            }
        }));
    }


    /**
     * @brief Connect to a project as a host
     * @param instance Project instance
    **/
    private static async hostConnect(instance: Project) : Promise<void> {
        // Check if not connected
        if (Project.instance || Project.connecting) {
            throw new Error("Connection failed : already connected");
        }
        Project._connecting = true;
        console.log("Host connect");

        // Connect
        try {
            await Project._hostConnect(instance);
        }
        catch (error: any) {
            vscode.window.showErrorMessage(error.message);
            console.error(error);
            await Project._disconnect(instance);
        }
        finally {
            Project._connecting = false;
        }
    }

    private static async _hostConnect(instance: Project) : Promise<void> {
        // Connect
        await LiveShare.activate();
        await instance.fileSystem.download();
        await LiveShare.instance!.createSession();
        instance.state.url = LiveShare.instance!.sessionUrl!;
        await GoogleDrive.instance!.setState(instance.project, instance.state);
        await instance.fileSystem.startSync(true);
        setTimeout(() => {
            if (Project.instance === instance) {
                instance.startUpload();
            }
        }, 5_000);
        Project._instance = instance;
        LiveShare.instance!.onSessionEnd = showErrorWrap(async () => await Project.disconnect());

        // Setup editor
        await IgnoreStaticDecorationProvider.instance?.update();
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        await vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
        await vscode.commands.executeCommand("workbench.action.terminal.killAll");
        await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
    }


    /**
     * @brief Connect to a project as a guest
     * @param instance Project instance
    **/
    private static async guestConnect(instance: Project) : Promise<void> {
        // Check if not connected
        if (Project.instance || Project.connecting) {
            throw new Error("Connection failed : already connected");
        }
        Project._connecting = true;
        console.log("Guest connect");

        // Connect
        try {
            await Project._guestConnect(instance);
        }
        catch (error: any) {
            vscode.window.showErrorMessage(error.message);
            console.error(error);
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

        // Connect
        await instance.fileSystem.startSync(false);
        Project._instance = instance;
        context.globalState.update("projectState", undefined);

        // Update previous folder
        const previousFolder = context.globalState.get<PreviousFolder>("previousFolder")!;
        previousFolder.connected = true;
        previousFolder.sessionUrl = LiveShare.instance!.sessionUrl!;
        context.globalState.update("previousFolder", previousFolder);
        LiveShare.instance!.onIndexChanged = (index) => {
            previousFolder.userIndex = index;
            context.globalState.update("previousFolder", previousFolder);
        };

        // Default settings
        for (const [key, value] of Object.entries(guestDefaultSettings)) {
            await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Workspace);
        }

        // Setup editor
        await IgnoreStaticDecorationProvider.instance?.update();
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
        await vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
        await vscode.commands.executeCommand("workbench.action.terminal.killAll");
        await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
    }


    /**
     * @brief Reconnect to the project in the current folder
     * @param sessionUrl Previous session url
     * @param userIndex Previous session user index
    **/
    private static async reconnect(sessionUrl: string, userIndex: number) : Promise<void> {
        // Check if not connected
        if (Project.instance || Project.connecting) {
            throw new Error("Connection failed : already connected");
        }
        Project._connecting = true;
        console.log("Reconnect");

        try {
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as DriveProject;
            let state: ProjectState;

            // Wait for previous host to disconnect
            let endTime = Date.now() + 5_000;
            while (true) {
                state = await GoogleDrive.instance!.getState(project);
                if (userIndex === 1 && state.url === "") {
                    console.log("Previous disconnected");
                    break;
                }
                if (state.url !== sessionUrl) {
                    console.log("New connected");
                    break;
                }
                if (Date.now() > endTime) {
                    console.log("Timeout");
                    break;
                }
                await sleep(1_000);
            }

            if (userIndex === 1 || (state.url !== "" && state.url !== sessionUrl)) {
                // Connect
                Project._connecting = false;
                await Project.connect(project, state);
            }
            else {
                // Wait for new host to connect
                endTime = Date.now() + (state.url === "" ? 20_000 : 40_000) * (userIndex - 1);
                while (true) {
                    state = await GoogleDrive.instance!.getState(project);
                    if (state.url !== "" && state.url !== sessionUrl) {
                        console.log("New connected");
                        break;
                    }
                    if (Date.now() > endTime) {
                        console.log("Timeout");
                        break;
                    }
                    await sleep(1_000);
                }

                // Connect
                Project._connecting = false;
                await Project.connect(project, state);
            }
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
            console.log("Disconnect");
            const instance = Project.instance!;
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
        console.log("_disconnect");
        Project._instance = undefined;
        instance.mustUpload = false;
        instance.fileSystem.stopSync();
        LiveShare.instance!.onIndexChanged = () => {};
        LiveShare.instance!.onSessionEnd = () => {};
        if (!instance.host) {
            // Update previous folder
            const previousFolder = context.globalState.get<PreviousFolder>("previousFolder");
            if (previousFolder) {
                previousFolder.disconnected = true;
                await context.globalState.update("previousFolder", previousFolder);
            }

            await instance.fileSystem.clear(new FilesConfig(), false);
        }
        await LiveShare.instance!.exitSession();
        if (instance.host) {
            await instance.fileSystem.clear(new FilesConfig(), true);

            // Setup editor
            await vscode.commands.executeCommand("workbench.action.terminal.killAll");
            await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
        }
    }

    
    /**
     * @brief Start uploading files regularly to Google Drive
    **/
    private startUpload() : void {
        console.log("Start upload");
        this.mustUpload = true;
        this.upload();
    }

    private async upload() : Promise<void> {
        while (true) {
            try {
                // Check if this user is the host
                if ((await GoogleDrive.instance!.getState(this.project)).url !== LiveShare.instance!.sessionUrl) {
                    vscode.window.showErrorMessage("Another user is the host for this project");
                    console.error(new Error("Another user is the host for this project"));
                    await Project._disconnect(this);
                    await Project.connect();
                }
            }
            catch (error: any) {
                vscode.window.showErrorMessage(error.message);
                console.error(error);
            }

            // Wait 1 minute
            await sleep(60_000);
            await waitFor(() => this.mustUpload !== undefined);
            if (!this.mustUpload) {
                break;
            }

            try {
                // Upload
                this.uploading = true;
                await vscode.commands.executeCommand("workbench.action.files.saveAll");
                await sleep(1000);
                await this.fileSystem.upload((await this.getConfig()).filesConfig);
                this.uploading = false;
                await waitFor(() => this.mustUpload !== undefined);
                if (!this.mustUpload) {
                    break;
                }
            }
            catch (error: any) {
                this.uploading = false;
                vscode.window.showErrorMessage(error.message);
                console.error(error);
            }
        }
    }

    /**
     * @brief Stop uploading files regularly to Google Drive
    **/
    private async stopUpload() : Promise<void> {
        console.log("Stop upload");
        this.mustUpload = undefined; // Pause upload
        if (this.uploading) {
            await waitFor(() => !this.uploading);
        }
        try {
            await vscode.commands.executeCommand("workbench.action.files.saveAll");
            await sleep(1000);
            await this.fileSystem.upload((await this.getConfig()).filesConfig, true);
        }
        catch (error: any) {
            this.mustUpload = true; // Resume upload
            throw error;
        }
        this.mustUpload = false; // Stop upload
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
        await vscode.commands.executeCommand("workbench.action.terminal.newWithCwd", { cwd: this.fileSystem.projectPath });
    }


    /**
     * @brief Prompt the user to select files to add to the project
     * @param uri The URI of the folder to add the files to
    **/
    public async uploadFiles(uri: vscode.Uri) : Promise<void> {
        // Prompt user to select files
        const files = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.parse("file:///"), title: "Select files to upload", canSelectMany: true });
        if (!files) {
            throw new Error("Upload failed : no files selected");
        }

        // Get the name of the folder
        let name = collaborationName(uri);
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.type !== vscode.FileType.Directory) {
            name = name.substring(0, name.lastIndexOf("/"));
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
     * @brief Get the .collabconfig file in the current folder if it exists, create a default one otherwise
    **/
    public async getConfig() : Promise<Config> {
        let config: Config;
        try {
            config = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(collaborationUri(".collabconfig")))) as Config;
        }
        catch {
            console.log("Create config");
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as DriveProject;
            config = new Config(project.name, new FilesConfig(), new ShareConfig(await GoogleDrive.instance!.getEmail()));
            await vscode.workspace.fs.writeFile(collaborationUri(".collabconfig"), new TextEncoder().encode(JSON.stringify(config, null, 4)));
            vscode.window.showInformationMessage("Project configuration file created");
        }
        return config;
    }

}



export class Config {
    public constructor(
        public name: string, 
        public filesConfig: FilesConfig,
        public shareConfig: ShareConfig
    ) {}
}



export class ShareConfig {
    public invites: Permission[] = [];
    public members: Permission[] = [];
    public public: Permission | null = null;
    public publicMembers: string[] = [];

    public constructor(public owner: string) {}
}



class PreviousFolder {
    public active: boolean = false;
    public connected: boolean = false;
    public disconnected: boolean = false;
    public sessionUrl: string = "";
    public userIndex: number = 0;
    public constructor(
        public path: string
    ) {}
}