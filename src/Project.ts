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

}