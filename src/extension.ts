import * as vscode from "vscode";
import { GoogleDrive } from "./GoogleDrive";
import { Project } from "./Project";
import { LiveShare } from "./LiveShare";
import { LaunchEditorProvider } from "./LaunchEditor";


export let context : vscode.ExtensionContext;
let folder: vscode.Uri;
let storageFolder: vscode.Uri;


// Function called when the extension is activated
export async function activate(_context: vscode.ExtensionContext) {
	context = _context;
    if (vscode.workspace.workspaceFolders) {
        folder = vscode.workspace.workspaceFolders?.[0].uri;
    }
    if (context.storageUri) {
        storageFolder = context.storageUri;
    }

	// Custom contexts for 'when' clauses
	vscode.commands.executeCommand("setContext", "cloud-collaboration.authenticated", false);
    vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
    vscode.commands.executeCommand("setContext", "cloud-collaboration.liveShareAvailable", false);

    // Activate classes
    await LiveShare.activate();
    await GoogleDrive.activate();
    await Project.activate();

	// Register commands
	const authenticate = vscode.commands.registerCommand("cloud-collaboration.authenticate", commandCallback(GoogleDrive.authenticate));
	context.subscriptions.push(authenticate);
	const unauthenticate = vscode.commands.registerCommand("cloud-collaboration.unauthenticate", commandCallback(GoogleDrive.unauthenticate));
	context.subscriptions.push(unauthenticate);
    const createProject = vscode.commands.registerCommand("cloud-collaboration.createProject", commandCallback(Project.createProject));
    context.subscriptions.push(createProject);
    const joinSharedProject = vscode.commands.registerCommand("cloud-collaboration.joinProject", commandCallback(Project.joinProject));
    context.subscriptions.push(joinSharedProject);
    const connect = vscode.commands.registerCommand("cloud-collaboration.connect", commandCallback(Project.connect));
    context.subscriptions.push(connect);
    const disconnect = vscode.commands.registerCommand("cloud-collaboration.disconnect", commandCallback(Project.disconnect));
    context.subscriptions.push(disconnect);

    // Register editors
    const launchEditor = vscode.window.registerCustomEditorProvider("cloud-collaboration.launchEditor", new LaunchEditorProvider());
    context.subscriptions.push(launchEditor);
}


// Function called when the extension is deactivated
export function deactivate() {
    // Deactivate classes
    GoogleDrive.deactivate();
}


/**
 * @brief Wrap a command callback to display errors
 * @param callback Callback to wrap
 * @returns Wrapped callback
**/
function commandCallback(callback: () => any) : () => Promise<void> {
    return async () => {
        try {
            await callback();
        }
        catch (error : any) {
            vscode.window.showErrorMessage(error.message);
            console.error(error);
        }
    };
}



/**
 * @brief Get the URI of a file in the current folder
 * @param fileName Name of the file
**/
export function fileUri(fileName: string) : vscode.Uri {
    return vscode.Uri.joinPath(folder, fileName);
}


/**
 * @brief Get the URI of a file in the storage folder
 * @param fileName Name of the file
**/
export function storageFileUri(fileName: string) : vscode.Uri {
    return vscode.Uri.joinPath(storageFolder, fileName);
}


/**
 * @brief List the files in the current folder
 * @returns List of file names and types
**/
export async function listFolder() : Promise<[string, vscode.FileType][]> {
    return await vscode.workspace.fs.readDirectory(folder);
}


/**
 * @brief Recursively get the names (with sub-folder names) of all files in the current folder
**/
export function recurListFolder() : Promise<string[]> {
    return _recurListFolder(folder);

}

async function _recurListFolder(folder: vscode.Uri, subfolder: string = "") : Promise<string[]> {
    let fileNames = [];
    const files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(folder, subfolder));
    for (const [name, type] of files) {
        if (type === vscode.FileType.File) {
            fileNames.push(subfolder + "/" + name);
        }
        else if (type === vscode.FileType.Directory) {
            fileNames.push(...await _recurListFolder(folder, subfolder + "/" + name));
        }
    }
    return fileNames;
}