import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, ProjectState } from "./GoogleDrive";
import { LiveShare } from "./LiveShare";
import { FileSystem, FilesConfig } from "./FileSystem";
import { context, fileUri, listFolder } from "./extension";


export class Project {

    private static instance : Project | undefined = undefined;
    public static get Instance() : Project | undefined { return Project.instance; }

    private intervalID : NodeJS.Timeout | undefined = undefined;

    private constructor(
        private project: GoogleDriveProject, 
        private state: ProjectState, 
        private host: boolean, 
        private fileSystem: FileSystem | null
    ) {}


    /**
     * @brief Activate Project class
    **/
    public static async activate() : Promise<void> {
        // Restore project state after a restart for joining a Live Share session
        const project = context.globalState.get<Project>("projectState");
        if (project) {
            Project.instance = new Project(project.project, project.state, project.host, project.fileSystem);
            vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
            context.globalState.update("projectState", undefined);
            if (project.host) { // Start uploading files regularly
                Project.instance.startUpload();
            }
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

        // Create project
        if (!GoogleDrive.Instance) {
            throw new Error("Can't create project : not authenticated");
        }
        const project = await GoogleDrive.Instance.createProject(name);
        
        // .collablaunch file
        vscode.workspace.fs.writeFile(fileUri(".collablaunch"), new TextEncoder().encode(JSON.stringify(project, null, 4)));
        vscode.window.showInformationMessage("Project created successfully");
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
        await GoogleDrive.Instance.pickProject((project) => {
            // .collablaunch file
            vscode.workspace.fs.writeFile(fileUri(".collablaunch"), new TextEncoder().encode(JSON.stringify(project, null, 4)));
            vscode.window.showInformationMessage("Project joined successfully");
        });
    }


    /**
     * @brief Connect to the project in the current folder
    **/
    public static async connect() : Promise<void> {
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
        const host = state.url === "";

        let fileSystem = null;
        if (host) {
            // Create Live Share session
            state.url = await LiveShare.Instance.createSession();
            await GoogleDrive.Instance.setState(project, state);

            // Load project files
            fileSystem = await FileSystem.init(project, state);
            if (state.staticVersion === 0 && state.dynamicVersion === 0) { // New project -> create .collabconfig file
                const config = new Config(project.name, new FilesConfig());
                vscode.workspace.fs.writeFile(fileUri(".collabconfig"), new TextEncoder().encode(JSON.stringify(config, null, 4)));
            }
            else { // Download from Google Drive
                await fileSystem.download();
            }
        }
        else {
            // Join Live Share session
            await LiveShare.Instance.joinSession(state.url);
        }    

        // Set instance
        Project.instance = new Project(project, state, host, fileSystem);
        if (host) { // Start uploading files regularly
            Project.instance.startUpload();
        }
        else { // Save project state (the extension will restart when joining the Live Share session)
            context.globalState.update("projectState", Project.instance);
        }

        vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
    }


    /**
     * @brief Disconnect from the project
    **/
    public static async disconnect() : Promise<void> {
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
            const state = Project.Instance.state;
            state.url = "";
            await GoogleDrive.Instance.setState(Project.Instance.project, state);
            await Project.Instance.upload(true);
        }
        
        Project.Instance.stopUpload();
        Project.instance = undefined;
        vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
    }


    /**
     * @brief Start uploading files regularly to Google Drive
    **/
    private startUpload() : void {
        this.intervalID = setInterval(this.upload.bind(this), 60_000);
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
        const config = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri(".collabconfig")))) as Config;

        await this.fileSystem.upload(config.filesConfig);
        if (clear) {
            await this.fileSystem.clear(config.filesConfig);
        }
    }

}



export class Config {
    public constructor(
        public name: string, 
        public filesConfig: FilesConfig
    ) {}
}