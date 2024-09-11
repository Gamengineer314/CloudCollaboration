import * as vscode from "vscode";
import { GoogleDrive, DriveProject, Permission } from "./GoogleDrive";
import { LiveShare } from "./LiveShare";
import { FileSystem, FilesConfig } from "./FileSystem";
import { collaborationFolder, context, currentFolder } from "./extension";
import { fileUri, currentUri, collaborationUri, listFolder, currentListFolder, showErrorWrap, waitFor, collaborationName } from "./util";
import { IgnoreStaticDecorationProvider } from "./FileDecoration";


const defaultSettings = `{
    "liveshare.autoShareTerminals": false,
    "files.saveConflictResolution": "overwriteFileOnDisk",
    "terminal.integrated.defaultProfile.linux": "Cloud Collaboration",
    "terminal.integrated.defaultProfile.windows": "Cloud Collaboration",
    "terminal.integrated.defaultProfile.osx": "Cloud Collaboration"
}`;


export class Project {

    private static _instance : Project | undefined = undefined;
    public static get instance() : Project | undefined { return Project._instance; }

    private intervalID : NodeJS.Timeout | undefined = undefined;

    private constructor(
        private project: DriveProject,
        private host: boolean,
        private fileSystem: FileSystem
    ) {}

    public get driveProject() : DriveProject { return this.project; }
    public get projectPath() : string { return this.fileSystem.projectPath; }


    /**
     * @brief Activate Project class
    **/
    public static async activate() : Promise<void> {
        // Restore project state after a restart for joining a Live Share session
        const project = context.globalState.get<Project>("projectState");
        const previousFolder = context.globalState.get<PreviousFolder>("previousFolder");
        if (project) { // Connected to a project
            // Activate previous folder
            if (previousFolder) {
                previousFolder.active = true;
                context.globalState.update("previousFolder", previousFolder);
            }

            // Continue connecting
            context.globalState.update("projectState", undefined);
            Project.continueConnect(new Project(project.project, project.host, FileSystem.copy(project.fileSystem)));
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
            if (!GoogleDrive.instance) {
                throw new Error("Can't create project : not authenticated");
            }
            const project = await GoogleDrive.instance.createProject(name);
            
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
            await vscode.workspace.fs.writeFile(currentUri(".vscode/settings.json"), new TextEncoder().encode(defaultSettings));
            vscode.window.showInformationMessage("Project joined successfully");
        });
    }


    /**
     * @brief Connect to the project in the current folder
    **/
    public static async connect() : Promise<void> {
        // Check if authenticated
        if (!GoogleDrive.instance) {
            await GoogleDrive.authenticate();
            if (!GoogleDrive.instance) {
                throw new Error("Connection failed : not authenticated");
            }
        }
        
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(async () => {
            // Check instances
            if (!GoogleDrive.instance) {
                throw new Error("Connection failed : not authenticated");
            }
            if (Project.instance) {
                throw new Error("Connection failed : already connected");
            }
            if (!LiveShare.instance) {
                throw new Error("Connection failed : Live Share not initialized");
            }

            // Get project information from .collablaunch file
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as DriveProject;
            const state = await GoogleDrive.instance.getState(project);
            const host = state.url === "";
            const fileSystem = await FileSystem.init(project, state);

            if (host) {
                // Create instance
                const instance = new Project(project, host, fileSystem);
                await fileSystem.download();

                // Create Live Share session
                state.url = await LiveShare.instance.createSession();
                await GoogleDrive.instance.setState(project, state);

                // Start synchronization
                await fileSystem.startSync(true);
                instance.startUpload();

                // Connected
                Project._instance = instance;
                await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);

                // Setup workspace
                await IgnoreStaticDecorationProvider.instance?.update();
                await vscode.commands.executeCommand("workbench.action.closeAllEditors");
                await vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
                await vscode.commands.executeCommand("workbench.action.terminal.killAll");
            }
            else {
                // Save project state and join Live Share session (the extension will restart)
                context.globalState.update("projectState", new Project(project, host, fileSystem));
                await LiveShare.instance.joinSession(state.url);
            }
        }));
    }


    /**
     * @brief Continue connecting to the project after the extension restarted
     * @param instance Project instance
    **/
    public static async continueConnect(instance: Project) : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Connecting to project..." }, showErrorWrap(async () => {
            // Wait until the Live Share session is ready
            if (!LiveShare.instance) {
                throw new Error("Can't connect to project : Live Share not initialized");
            }
            await LiveShare.instance.waitForSession();
            await vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
            await waitFor(() => vscode.window.activeTextEditor !== undefined);

            // Start synchronization
            await instance.fileSystem.startSync(false);
            
            // Connected
            Project._instance = instance;
            await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);

            // Setup workspace
            await IgnoreStaticDecorationProvider.instance?.update();
            await vscode.commands.executeCommand("workbench.action.closeAllEditors");
            await vscode.commands.executeCommand("vscode.openWith", collaborationUri(".collabconfig"), "cloud-collaboration.configEditor");
            await vscode.commands.executeCommand("workbench.action.terminal.killAll");
        }));
    }


    /**
     * @brief Disconnect from the project
    **/
    public static async disconnect() : Promise<void> {
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Disconnecting from project..." }, showErrorWrap(async () => {
            // Check instances
            if (!GoogleDrive.instance) {
                throw new Error("Disconnection failed : not authenticated");
            }
            if (!Project.instance) {
                throw new Error("Disconnection failed : not connected");
            }
            if (!LiveShare.instance) {
                throw new Error("Disconnection failed : Live Share not initialized");
            }

            // Leave or end Live Share session
            const config = await Project.instance.getConfig();
            Project.instance.fileSystem.stopSync();
            await LiveShare.instance.exitSession();
            if (Project.instance.host) {
                const state = Project.instance.fileSystem.projectState;
                state.url = "";
                await GoogleDrive.instance.setState(Project.instance.project, state);
                await Project.instance.fileSystem.upload(config.filesConfig);
                await Project.instance.fileSystem.clear(config.filesConfig, true);
            }
            else {
                await Project.instance.fileSystem.clear(config.filesConfig, false);
            }
            
            Project.instance.stopUpload();
            Project._instance = undefined;
            await vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
            await vscode.commands.executeCommand("workbench.action.terminal.killAll");
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
            if (!GoogleDrive.instance) {
                throw new Error("Can't create config : not authenticated");
            }
            const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(currentUri(".collablaunch")))) as DriveProject;
            config = new Config(project.name, new FilesConfig(), new ShareConfig(await GoogleDrive.instance.getEmail()));
            await vscode.workspace.fs.writeFile(collaborationUri(".collabconfig"), new TextEncoder().encode(JSON.stringify(config, null, 4)));
            vscode.window.showInformationMessage("Project configuration file created");
        }
        return config;
    }


    /**
     * @brief Start uploading files regularly to Google Drive
    **/
    private startUpload() : void {
        this.intervalID = setInterval(showErrorWrap(async () => {
            await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Uploading to Google Drive..." }, 
                showErrorWrap(async () => await this.fileSystem.upload((await this.getConfig()).filesConfig))
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