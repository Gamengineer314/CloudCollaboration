import * as vscode from "vscode";
import { folder, storageFolder } from "./extension";


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