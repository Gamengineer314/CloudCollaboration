import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, Permission, ProjectState } from "./GoogleDrive";
import { LiveShare } from "./LiveShare";
import { FileSystem, FilesConfig } from "./FileSystem";
import { context, currentFolder } from "./extension";
import { fileUri, listFolder, showErrorWrap } from "./util";
import { json } from "stream/consumers";
import { resolve } from "path";


export class Project {

    private static instance : Project | undefined = undefined;
    public static get Instance() : Project | undefined { return Project.instance; }

    private intervalID : NodeJS.Timeout | undefined = undefined;

    private constructor(
        private project: GoogleDriveProject,
        private host: boolean, 
        private fileSystem: FileSystem | null
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
            Project.instance = new Project(project.project, project.host, project.fileSystem);
            context.globalState.update("projectState", undefined);
            
            if (previousFolder) { // Activate previous folder
                previousFolder.active = true;
                context.globalState.update("previousFolder", previousFolder);
            }

            await Project.instance.addToMember();
            vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
        }
        else { // Come back to previous folder if activated
            if (previousFolder && previousFolder.active) {
                await vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.parse(previousFolder.path), false);
            }
            context.globalState.update("previousFolder", new PreviousFolder(currentFolder.fsPath, false));
        }
    }


    /**
     * @brief Create a new project in the current folder
    **/
    public static async createProject() : Promise<void> {
        // Check if folder is empty
        const files = await listFolder();
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
            
            // .collablaunch file
            await vscode.workspace.fs.writeFile(fileUri(".collablaunch"), new TextEncoder().encode(JSON.stringify(project, null, 4)));
            vscode.commands.executeCommand("vscode.openWith", fileUri(".collablaunch"), "cloud-collaboration.launchEditor");
            vscode.window.showInformationMessage("Project created successfully");
        }));
    }


    /**
     * @brief Join a project in the current folder
    **/
    public static async joinProject() : Promise<void> {
        // Check if folder is empty
        const files = await listFolder();
        if (files.length > 0) {
            throw new Error("Can't join project : folder must be empty");
        }

        // Pick project
        if (!GoogleDrive.Instance) {
            throw new Error("Can't join project : not authenticated");
        }
        await GoogleDrive.Instance.pickProject(async (project) => {
            // .collablaunch file
            await vscode.workspace.fs.writeFile(fileUri(".collablaunch"), new TextEncoder().encode(JSON.stringify(project, null, 4)));
            vscode.commands.executeCommand("vscode.openWith", fileUri(".collablaunch"), "cloud-collaboration.launchEditor");
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
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri(".collablaunch")))) as GoogleDriveProject;
            const state = await GoogleDrive.Instance.getState(project);
            //const host = state.url === "";
            const host = true;

            let fileSystem = null;
            if (host) {
                // Create Live Share session
                state.url = await LiveShare.Instance.createSession();
                await GoogleDrive.Instance.setState(project, state);

                // Load project files
                fileSystem = await FileSystem.init(project, state);
                await fileSystem.download();

                // Create instance
                Project.instance = new Project(project, host, fileSystem);
                Project.instance.startUpload();

                await Project.instance.addToMember();
            }
            else {
                // Save project state and join Live Share session (the extension will restart)
                context.globalState.update("projectState", new Project(project, host, fileSystem));
                await LiveShare.Instance.joinSession(state.url);
            }

            vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
        }));
    }


    /**
     * @brief Add the current user to the project members and remove it from the invites
    **/
    private async addToMember() : Promise<void> {
        if (!GoogleDrive.Instance) {
            throw new Error("Can't add to member : not authenticated");
        }
        const email = await GoogleDrive.Instance.getEmail();
        const config = await Project.getConfig();
        const inviteIndex = config.shareConfig.invites.findIndex(invite => invite.name === email);
        if (inviteIndex !== -1) {
            config.shareConfig.members.push(config.shareConfig.invites[inviteIndex]);
            config.shareConfig.invites.splice(inviteIndex, 1);
            await Project.setConfig(config);
        }
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
            await LiveShare.Instance.exitSession();
            if (Project.Instance.host) {
                if (!Project.Instance.fileSystem) {
                    throw new Error("Disconnection failed : no file system");
                }
                const state = Project.Instance.fileSystem?.State;
                state.url = "";
                await GoogleDrive.Instance.setState(Project.Instance.project, state);
                await Project.Instance.upload(true);
            }
            
            Project.Instance.stopUpload();
            Project.instance = undefined;
            vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
        }));
    }


    /**
     * @brief Download files of the project to another folder
    **/
    public async download() : Promise<void> {
        // Pick folder
        const folder = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false });
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
            if (this.fileSystem) {
                await this.fileSystem.download(folder[0]);
            }
            else {
                if (!GoogleDrive.Instance) {
                    throw new Error("Download failed : not authenticated");
                }
                const state = await GoogleDrive.Instance.getState(this.project);
                const fileSytem = await FileSystem.init(this.project, state);
                await fileSytem.download(folder[0]);
            }
            await vscode.workspace.fs.delete(fileUri(".collabconfig", folder[0]));
            vscode.window.showInformationMessage("Project downloaded successfully");
        }));
    }


    /**
     * @brief Start uploading files regularly to Google Drive
    **/
    private startUpload() : void {
        this.intervalID = setInterval(showErrorWrap(async () => {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Uploading to Google Drive..." }, showErrorWrap(async () => Project.Instance?.upload()));
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
     * @brief Upload files to Google Drive
     * @param clear Wether to clear the folder after uploading or not
    **/
    private async upload(clear: boolean = false) : Promise<void> {
        if (!this.fileSystem) {
            throw new Error("Upload failed : no file system");
        }
        const config = await Project.getConfig();
        await this.fileSystem.upload(config.filesConfig);
        if (clear) {
            await this.fileSystem.clear(config.filesConfig);
        }
    }


    /**
     * @brief Get the .collabconfig file in the current folder if it exists, create a default one otherwise
    **/
    private static async getConfig() : Promise<Config> {
        let config: Config;
        try {
            config = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri(".collabconfig")))) as Config;
        }
        catch {
            if (!GoogleDrive.Instance) {
                throw new Error("Can't create config : not authenticated");
            }
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri(".collablaunch")))) as GoogleDriveProject;
            config = new Config(project.name, new FilesConfig(), new ShareConfig(await GoogleDrive.Instance.getEmail()));
            Project.setConfig(config);
        }
        return config;
    }


    /**
     * @brief Set the config file in the current folder
    **/
    private static async setConfig(config: Config) : Promise<void> {
        await vscode.workspace.fs.writeFile(fileUri(".collabconfig"), new TextEncoder().encode(JSON.stringify(config, null, 4)));
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
    public members: Permission[] = []
    public public: Permission | null = null;

    public constructor(public owner: string) {}
}


class PreviousFolder {
    public constructor(
        public path: string,
        public active: boolean
    ) {}
}