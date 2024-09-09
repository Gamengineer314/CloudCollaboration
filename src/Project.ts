import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, Permission } from "./GoogleDrive";
import { LiveShare } from "./LiveShare";
import { FileSystem, FilesConfig } from "./FileSystem";
import { collaborationFolder, context, currentFolder } from "./extension";
import { fileUri, currentUri, collaborationUri, listFolder, currentListFolder, showErrorWrap, waitFor } from "./util";


const defaultSettings = `{
    "liveshare.autoShareTerminals": false,
    "files.saveConflictResolution": "overwriteFileOnDisk"
}`;


export class Project {

    private static instance : Project | undefined = undefined;
    public static get Instance() : Project | undefined { return Project.instance; }

    private intervalID : NodeJS.Timeout | undefined = undefined;

    private constructor(
        private project: GoogleDriveProject,
        private host: boolean,
        private fileSystem: FileSystem
    ) {}

    public get Project() : GoogleDriveProject { return this.project; }


    /**
     * @brief Activate Project class
    **/
    public static async activate() : Promise<void> {
        // Restore project state after a restart for joining a Live Share session
        const project = context.globalState.get<Project>("projectState");
        const previousFolder = context.globalState.get<PreviousFolder>("previousFolder");
        if (project) { // Connected to a project
            Project.instance = new Project(project.project, project.host, FileSystem.copy(project.fileSystem));
            context.globalState.update("projectState", undefined);

            if (previousFolder) { // Activate previous folder
                previousFolder.active = true;
                context.globalState.update("previousFolder", previousFolder);
            }

            // Wait for the session to be joined
            if (!LiveShare.Instance) {
                throw new Error("Can't connect to project : Live Share not initialized");
            }
            LiveShare.Instance.waitForSession().then(async () => {
                await waitFor(() => vscode.window.activeTextEditor !== undefined);
                await Project.Instance?.fileSystem.startSync(false);
                await vscode.commands.executeCommand("workbench.action.closeAllEditors");
                await vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
                await vscode.commands.executeCommand("workbench.action.terminal.killAll");
                await Project.Instance?.newTerminal();
                await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
            });
        }
        else { // Come back to previous folder if activated
            if (previousFolder && previousFolder.active) {
                await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(previousFolder.path), false);
            }
            context.globalState.update("previousFolder", new PreviousFolder(currentFolder.path, false));
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

        // Ask for project name
        const name = await vscode.window.showInputBox({ prompt: "Project name" });
        if (!name) {
            throw new Error("Can't create project : no name provided");
        }

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Creating project..." }, showErrorWrap(async () => {
            // Create project
            if (!GoogleDrive.Instance) {
                throw new Error("Can't create project : not authenticated");
            }
            const project = await GoogleDrive.Instance.createProject(name);
            
            // Default files
            await vscode.workspace.fs.writeFile(currentUri(".collablaunch"), new TextEncoder().encode(JSON.stringify(project, null, 4)));
            await vscode.commands.executeCommand("vscode.openWith", currentUri(".collablaunch"), "cloud-collaboration.launchEditor");
            await vscode.workspace.fs.createDirectory(collaborationFolder);
            await vscode.workspace.fs.createDirectory(currentUri(".vscode"));
            await vscode.workspace.fs.writeFile(currentUri(".vscode/settings.json"), new TextEncoder().encode(defaultSettings));
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

        // Pick project
        if (!GoogleDrive.Instance) {
            throw new Error("Can't join project : not authenticated");
        }
        await GoogleDrive.Instance.pickProject(async (project) => {
            // Default files
            await vscode.workspace.fs.writeFile(currentUri(".collablaunch"), new TextEncoder().encode(JSON.stringify(project, null, 4)));
            await vscode.commands.executeCommand("vscode.openWith", currentUri(".collablaunch"), "cloud-collaboration.launchEditor");
            await vscode.workspace.fs.createDirectory(collaborationFolder);
            await vscode.workspace.fs.createDirectory(currentUri(".vscode"));
            await vscode.workspace.fs.writeFile(currentUri(".vscode/settings.json"), new TextEncoder().encode(defaultSettings));
            vscode.window.showInformationMessage("Project joined successfully");
        });
    }


    /**
     * @brief Connect to the project in the current folder
    **/
    public static async connect() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(async () => {
            // Check instances
            if (!GoogleDrive.Instance) {
                throw new Error("Connection failed : not authenticated");
            }
            if (Project.Instance) {
                throw new Error("Connection failed : already connected");
            }
            if (!LiveShare.Instance) {
                throw new Error("Connection failed : Live Share not initialized");
            }

            // Get project information from .collablaunch file
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as GoogleDriveProject;
            const state = await GoogleDrive.Instance.getState(project);
            const host = state.url === "";
            const fileSystem = await FileSystem.init(project, state);

            if (host) {
                // Create instance
                Project.instance = new Project(project, host, fileSystem);
                await fileSystem.download();

                // Create Live Share session
                state.url = await LiveShare.Instance.createSession();
                await GoogleDrive.Instance.setState(project, state);

                // Start synchronization
                await fileSystem.startSync(true);
                Project.instance.startUpload();

                // Open config and terminal
                await Project.getConfig();
                await vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
                await vscode.commands.executeCommand("workbench.action.terminal.killAll");
                await Project.instance.newTerminal();
                await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
            }
            else {
                // Save project state and join Live Share session (the extension will restart)
                context.globalState.update("projectState", new Project(project, host, fileSystem));
                await LiveShare.Instance.joinSession(state.url);
            }
        }));
    }


    /**
     * @brief Disconnect from the project
    **/
    public static async disconnect() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disconnecting from project..." }, showErrorWrap(async () => {
            // Check instances
            if (!GoogleDrive.Instance) {
                throw new Error("Disconnection failed : not authenticated");
            }
            if (!Project.Instance) {
                throw new Error("Disconnection failed : not connected");
            }
            if (!LiveShare.Instance) {
                throw new Error("Disconnection failed : Live Share not initialized");
            }

            // Leave or end Live Share session
            const config = await Project.getConfig();
            Project.Instance.fileSystem.stopSync();
            await LiveShare.Instance.exitSession();
            if (Project.Instance.host) {
                const state = Project.Instance.fileSystem.State;
                state.url = "";
                await GoogleDrive.Instance.setState(Project.Instance.project, state);
                await Project.Instance.fileSystem.upload(config.filesConfig);
                await Project.Instance.fileSystem.clear(config.filesConfig, true);
            }
            else {
                await Project.Instance.fileSystem.clear(config.filesConfig, false);
            }
            
            Project.Instance.stopUpload();
            Project.instance = undefined;
            await vscode.commands.executeCommand("workbench.action.terminal.killAll");
            await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
        }));
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
            await this.fileSystem.download(folder[0]);
            await vscode.workspace.fs.delete(fileUri(".collabconfig", folder[0]));
            vscode.window.showInformationMessage("Project downloaded successfully");
        }));
    }


    /**
     * @brief Open a terminal in the folder with a copy of the project
    **/
    public async newTerminal() : Promise<void> {
        await this.fileSystem.openProjectTerminal();
    }


    /**
     * @brief Prompt the user to select files to add to the project
    **/
    public async uploadFiles() : Promise<void> {
        const files = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.parse("file:///"), title: "Select files to upload", canSelectMany: true });
        if (!files) {
            throw new Error("Upload failed : no files selected");
        }
        await this.fileSystem.addFiles(files);
        vscode.window.showInformationMessage("Files uploaded successfully");
    }


    /**
     * @brief Start uploading files regularly to Google Drive
    **/
    private startUpload() : void {
        this.intervalID = setInterval(showErrorWrap(async () => {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Uploading to Google Drive..." }, 
                showErrorWrap(async () => await this.fileSystem.upload((await Project.getConfig()).filesConfig))
            );
        }), 60_000);
    }


    /**
     * @brief Stop uploading files regularly
    **/
    private stopUpload() : void {
        if (this.intervalID) {
            clearInterval(this.intervalID);
            this.intervalID = undefined;
        }
    }


    /**
     * @brief Get the .collabconfig file in the current folder if it exists, create a default one otherwise
    **/
    private static async getConfig() : Promise<Config> {
        let config: Config;
        try {
            config = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(collaborationUri(".collabconfig")))) as Config;
        }
        catch {
            if (!GoogleDrive.Instance) {
                throw new Error("Can't create config : not authenticated");
            }
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as GoogleDriveProject;
            config = new Config(project.name, new FilesConfig(), new ShareConfig(await GoogleDrive.Instance.getEmail()));
            await vscode.workspace.fs.writeFile(collaborationUri(".collabconfig"), new TextEncoder().encode(JSON.stringify(config, null, 4)));
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
    public constructor(
        public path: string,
        public active: boolean
    ) {}
}