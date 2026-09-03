import * as vscode from "vscode";
import { collaborationFolder, projectFolder, output } from "./extension";


/**
 * @brief Get a random string
 * @param size Size of the string
**/
export function randomString(size: number) : string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < size; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}


/**
 * @brief Get the URI of a file in the collaboration folder
 * @param fileName Name of the file
**/
export function collaborationUri(fileName: string) : vscode.Uri {
    return vscode.Uri.joinPath(collaborationFolder, fileName);
}

/**
 * @brief Get the name of a file in the collaboration folder
 * @param uri URI of the file
**/
export function collaborationName(uri: vscode.Uri) : string {
    return uri.path.substring(collaborationFolder.path.length);
}

/**
 * Check whether a file is in the collaboration folder
 * @param uri URI of the file
 * @returns Whether the file is in the collaboration folder
**/
export function inCollaboration(uri: vscode.Uri) : boolean {
    return uri.path.startsWith(collaborationFolder.path);
}


/**
 * @brief Get the URI of a file in the project folder
 * @param fileName Name of the file
**/
export function projectUri(name: string) : vscode.Uri {
    return vscode.Uri.joinPath(projectFolder, name);
}

/**
 * @brief Get the name of a file in the project folder
 * @param uri URI of the file
**/
export function projectName(uri: vscode.Uri) : string {
    return uri.path.substring(projectFolder.path.length);
}

/**
 * @brief Get the name of a file in the project folder from its name in the collaboration folder
 * @param name Name of the file in the collaboration folder
 * @returns Name of the file in the project folder
**/
export function toProjectName(name: string) {
    if (name.endsWith(".collab64")) {
        return name.substring(0, name.length - 9);
    }
    return name;
}


/**
 * @brief Recursively get the names (with sub-folder names) of all files in a folder
 * @param folder The folder
 * @param types Types of files to list (default: [FileType.File])
 * @note The names are returned in depth-first order
**/
export function recurListFolder(folder: vscode.Uri, types: vscode.FileType[] = [vscode.FileType.File]) : Promise<string[]> {
    return _recurListFolder(folder || collaborationFolder, types);
}

async function _recurListFolder(folder: vscode.Uri, types: vscode.FileType[], subfolder: string = "") : Promise<string[]> {
    let fileNames = [];
    const files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(folder, subfolder));
    for (const [name, type] of files) {
        if (type === vscode.FileType.Directory) {
            fileNames.push(...await _recurListFolder(folder, types, subfolder + "/" + name));
        }
        if (types.includes(type)) {
            fileNames.push(subfolder + "/" + name);
        }
    }
    return fileNames;
}


/**
 * @brief Recursively get the names (with sub-folder names) of all files in the collaboration folder
 * @param types Types of files to list (default: [FileType.File])
 * @note If listType = FileType.Directory, the name of a folder is always given before the name of all its parent folders
**/
export async function collaborationRecurListFolder(types: vscode.FileType[] = [vscode.FileType.File]) : Promise<string[]> {
    return await recurListFolder(collaborationFolder, types);
}


/**
 * @brief Recursively get the names (with sub-folder names) of all files in the project folder
 * @param types Types of files to list (default: [FileType.File])
 * @note If listType = FileType.Directory, the name of a folder is always given before the name of all its parent folders
**/
export async function projectRecurListFolder(types: vscode.FileType[] = [vscode.FileType.File]) : Promise<string[]> {
    return await recurListFolder(projectFolder, types);
}


/**
 * @brief Check if a file exists
 * @param uri URI of the file
**/
export async function exists(uri: vscode.Uri) : Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    }
    catch {
        return false;
    }
}


/**
 * @brief Wrap a function to display errors
 * @param action Function to wrap
 * @returns Wrapped function
**/
export function showErrorWrap(action: ((...args: any) => void | Promise<void>)) : (...args: any) => Promise<void> {
    return async (...args) => {
        try {
            await action(...args);
        }
        catch (error: any) {
            logError(error.message, error);
        }
    };
}


/**
 * @brief Sleep for a given time
 * @param ms Time to sleep (in milliseconds)
**/
export async function sleep(ms: number) : Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}


/**
 * @brief Wait for a condition to be true
 * @param condition Condition to wait for
 * @param interval Time between checks (in milliseconds)
**/
export async function waitFor(condition: () => boolean, interval: number = 100) : Promise<void> {
    while (!condition()) {
        await sleep(interval);
    }
}


export class Mutex {
    private _locked: boolean = false;
    public get locked() : boolean { return this._locked; }

    /**
     * @brief Wait until the mutex is unlocked, then lock it
    **/
    public async lock() : Promise<void> {
        if (this._locked) {
            await waitFor(() => !this._locked);
        }
        this._locked = true;
    }

    /**
     * @brief Unlock the mutex
    **/
    public unlock() {
        this._locked = false;
    }
}


/**
 * @brief Log a message to the console and the output channel
**/
export function log(message: string) {
    output.appendLine(message);
    console.log(`[${new Date().toLocaleString()}] ${message}`);
}


/**
 * @brief Show an error message to the user and log it to the console and the output channel
**/
export function logError(message: string, error: Error | undefined = undefined) {
    vscode.window.showErrorMessage(message);
    output.error(message);
    console.error(error || new Error(message));
}