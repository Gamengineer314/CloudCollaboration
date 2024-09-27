import * as vscode from "vscode";
import { collaborationFolder, currentFolder, output } from "./extension";


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
 * @brief Get the URI of a file in a given folder
 * @param fileName Name of the file
 * @param folder The folder
**/
export function fileUri(fileName: string, folder: vscode.Uri) : vscode.Uri {
    return vscode.Uri.joinPath(folder, fileName);
}


/**
 * @brief Get the URI of a file in the current folder
 * @param fileName Name of the file
**/
export function currentUri(fileName: string) : vscode.Uri {
    return fileUri(fileName, currentFolder);
}


/**
 * @brief Get the URI of a file in the collaboration folder
 * @param fileName Name of the file
**/
export function collaborationUri(fileName: string) : vscode.Uri {
    return fileUri(fileName, collaborationFolder);
}


/**
 * @brief Get the name of a file in the collaboration folder
 * @param uri URI of the file
**/
export function collaborationName(uri: vscode.Uri) : string {
    return uri.path.substring(collaborationFolder.path.length);
}


/**
 * @brief List the files in a folder
 * @param folder The folder
 * @returns List of file names and types
**/
export async function listFolder(folder: vscode.Uri) : Promise<[string, vscode.FileType][]> {
    return await vscode.workspace.fs.readDirectory(folder);
}


/**
 * @brief List the files in the current folder
 * @returns List of file names and types
**/
export async function currentListFolder() : Promise<[string, vscode.FileType][]> {
    return await listFolder(currentFolder);
}


/**
 * @brief List the files in the collaboration folder
 * @returns List of file names and types
**/
export async function collaborationListFolder() : Promise<[string, vscode.FileType][]> {
    return await listFolder(collaborationFolder);
}


/**
 * @brief Recursively get the names (with sub-folder names) of all files in a folder
 * @param folder The folder
 * @param listType Type of files to list
 * @note If listType = FileType.Directory, the name of a folder is always given before the name of all its parent folders
**/
export function recurListFolder(folder: vscode.Uri, listType: vscode.FileType = vscode.FileType.File) : Promise<string[]> {
    return _recurListFolder(folder || currentFolder, listType);
}

async function _recurListFolder(folder: vscode.Uri, listType: vscode.FileType = vscode.FileType.File, subfolder: string = "") : Promise<string[]> {
    let fileNames = [];
    const files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(folder, subfolder));
    for (const [name, type] of files) {
        if (type === vscode.FileType.Directory) {
            fileNames.push(...await _recurListFolder(folder, listType, subfolder + "/" + name));
        }
        if (type === listType) {
            fileNames.push(subfolder + "/" + name);
        }
    }
    return fileNames;
}


/**
 * @brief Recursively get the names (with sub-folder names) of all files in the current folder
 * @param listType Type of files to list
 * @note If listType = FileType.Directory, the name of a folder is always given before the name of all its parent folders
**/
export async function currentRecurListFolder(listType: vscode.FileType = vscode.FileType.File) : Promise<string[]> {
    return await recurListFolder(currentFolder, listType);
}


/**
 * @brief Recursively get the names (with sub-folder names) of all files in the collaboration folder
 * @param listType Type of files to list
 * @note If listType = FileType.Directory, the name of a folder is always given before the name of all its parent folders
**/
export async function collaborationRecurListFolder(listType: vscode.FileType = vscode.FileType.File) : Promise<string[]> {
    return await recurListFolder(collaborationFolder, listType);
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
        catch (error : any) {
            logError(error.message);
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
export function logError(message: string) {output.appendLine(message);
    vscode.window.showErrorMessage(message);
    output.error(message);
    console.error(new Error(`[${new Date().toLocaleString()}] ${message}`));
}