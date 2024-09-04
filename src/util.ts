import * as vscode from "vscode";
import { currentFolder } from "./extension";


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
 * @param folder The folder (default: current folder)
**/
export function fileUri(fileName: string, folder: vscode.Uri | null = null) : vscode.Uri {
    return vscode.Uri.joinPath(folder || currentFolder, fileName);
}


/**
 * @brief List the files in a folder
 * @param folder The folder (default: current folder)
 * @returns List of file names and types
**/
export async function listFolder(folder: vscode.Uri | null = null) : Promise<[string, vscode.FileType][]> {
    return await vscode.workspace.fs.readDirectory(folder || currentFolder);
}


/**
 * @brief Recursively get the names (with sub-folder names) of all files in a folder.
 * @param folder The folder (default: current folder)
 * @param listType Type of files to list
 * @note If listType = FileType.Directory, the name of a folder is always given before the name of all its parent folders
**/
export function recurListFolder(folder: vscode.Uri | null = null, listType: vscode.FileType = vscode.FileType.File) : Promise<string[]> {
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
 * @brief Wrap a function to display errors
 * @param action Function to wrap
 * @returns Wrapped function
**/
export function showErrorWrap(action: ((...args: any) => any)) : (...args: any) => Promise<void> {
    return async (...args) => {
        try {
            await action(...args);
        }
        catch (error : any) {
            vscode.window.showErrorMessage(error.message);
            console.error(error);
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