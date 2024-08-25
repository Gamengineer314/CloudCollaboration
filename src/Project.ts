import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, ProjectState } from "./GoogleDrive";
import { LiveShare } from "./LiveShare";
import { context } from "./extension";


export class Project {

    private static instance : Project | undefined = undefined;
    public static get Instance() : Project | undefined { return Project.instance; }


    private constructor(private project: GoogleDriveProject, private state: ProjectState, private host: boolean) {}


    /**
     * @brief Activate Project class
    **/
    public static async activate() : Promise<void> {
        // Restore project state after a restart for joining a Live Share session
        const project = context.globalState.get<Project>("projectState");
        if (project) {
            Project.instance = new Project(project.project, project.state, project.host);
            vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
            context.globalState.update("projectState", undefined);
        }
        else {
            vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
        }
    }


    /**
     * @brief Create a new project in the current folder
    **/
    public static async createProject() : Promise<void> {
        // Check if folder is empty
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Can't create project : no folder opened");
        }
        const files = await vscode.workspace.fs.readDirectory(folder);
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
        const configUri = vscode.Uri.joinPath(folder, "/.collablaunch");
        vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(JSON.stringify(project, null, 4)));
        vscode.window.showInformationMessage("Project created successfully");
    }


    /**
     * @brief Join a project in the current folder
    **/
    public static async joinProject() : Promise<void> {
        // Check if folder is empty
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Can't join project : no folder opened");
        }
        const files = await vscode.workspace.fs.readDirectory(folder);
        if (files.length > 0) {
            throw new Error("Can't join project : folder must be empty");
        }

        // Pick project
        if (!GoogleDrive.Instance) {
            throw new Error("Can't join project : not authenticated");
        }
        await GoogleDrive.Instance.pickProject((project) => {
            // .collablaunch file
            const configUri = vscode.Uri.joinPath(folder, "/.collablaunch");
            vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(JSON.stringify(project, null, 4)));
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
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Connection failed : no folder opened");
        }
        const files = await vscode.workspace.fs.readDirectory(folder);
        if (files.length !== 1 || files[0][0] !== ".collablaunch") {
            throw new Error("Connection failed : folder must contain a single .collablaunch file");
        }
        const projectUri = vscode.Uri.joinPath(folder, "/.collablaunch");
        const project = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(projectUri))) as GoogleDriveProject;

        // Get or create Live Share session
        const state = await GoogleDrive.Instance.getState(project);
        const host = state.url === "";
        if (host) {
            state.url = await LiveShare.Instance.createSession();
            await GoogleDrive.Instance.setState(project, state);
            vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", true);
        }
        else {
            await LiveShare.Instance.joinSession(state.url);
        }

        // Set instance and save it if not host (joining the session will restart the extension)
        Project.instance = new Project(project, state, host);
        if (!host) {
            context.globalState.update("projectState", Project.instance);
        }
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
        }
        
        Project.instance = undefined;
        vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
    }

}