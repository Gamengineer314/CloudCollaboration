import * as vscode from 'vscode';
import { GoogleDrive } from './GoogleDrive';
import { context } from "./extension";


export class Project {
    private static instance : Project | undefined = undefined;
    public static get Instance() : Project | undefined { return Project.instance; }


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
        const { filesID, indexID, urlID } = await GoogleDrive.Instance.createProject(name);
        
        // .collablaunch file
        const configUri = vscode.Uri.joinPath(folder, "/.collablaunch");
        vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(JSON.stringify({ filesID: filesID, indexID: indexID, urlID: urlID, name: name, key: false }, null, 4)));
        vscode.window.showInformationMessage("Project created successfully");
    }


    /**
     * @brief Join a project that was shared with the user in the current folder
    **/
    public static async joinSharedProject() : Promise<void> {
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
        await GoogleDrive.Instance.pickProject((filesID, indexID, urlID, name) => {
            // .collablaunch file
            const configUri = vscode.Uri.joinPath(folder, "/.collablaunch");
            vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(JSON.stringify({ filesID: filesID, indexID: indexID, urlID: urlID, name: name, key: false }, null, 4)));
            vscode.window.showInformationMessage("Project joined successfully");
        });
    }


    /**
     * @brief Join a project that was publicly shared in the current folder
    **/
    public static async joinPublicProject() : Promise<void> {
        // Check if folder is empty
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Can't join project : no folder opened");
        }
        const files = await vscode.workspace.fs.readDirectory(folder);
        if (files.length > 0) {
            throw new Error("Can't join project : folder must be empty");
        }

        // Ask for project ID
        const id = await vscode.window.showInputBox({ prompt: "Project id" });
        if (!id) {
            throw new Error("Can't join project : no id provided");
        }
        const ids = id.split(" ");

        // Check project
        if (!GoogleDrive.Instance) {
            throw new Error("Can't join project : not authenticated");
        }
        const name = await GoogleDrive.Instance.checkPublicProject(ids[0], ids[1], ids[2]);
        if (!name) {
            throw new Error("Can't join project : invalid project");
        }

        // .collablaunch file
        const configUri = vscode.Uri.joinPath(folder, "/.collablaunch");
        vscode.workspace.fs.writeFile(configUri, new TextEncoder().encode(JSON.stringify({ filesID: ids[0], indexID: ids[1], urlID: ids[2], name: name, key: true }, null, 4)));
        vscode.window.showInformationMessage("Project joined successfully");
    }

}