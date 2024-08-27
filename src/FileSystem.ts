import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, ProjectState } from "./GoogleDrive";
import { context } from "./extension";
import { FilesDeserializer, FilesSerializer } from "./FilesSerialization";
import { match } from "./FileRules";


export class FileSystem {

    private previousDynamic: Map<string, number> = new Map<string, number>(); // key: name, value: last modified time
    private previousStatic: Map<string, number> = new Map<string, number>();
    
    private constructor(
        private state: ProjectState, 
        private googleDriveProject: GoogleDriveProject,
        private storageProject: StorageProject
    ) {}


    /**
     * @brief Initialize a new file system for a project
     * @param project The project
     * @param state State of the project
    **/
    public static async init(project: GoogleDriveProject, state: ProjectState) : Promise<FileSystem> {
        // Default files for new projects
        const folder = context.storageUri;
        if (!folder) {
            throw new Error("FileSystem initialization failed : no storage folder");
        }
        const projectUri = vscode.Uri.joinPath(folder, "project.json");
        let storageProject;
        try {
            storageProject = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(projectUri)));
        }
        catch {
            storageProject = new StorageProject(0, "", "");
        }
        if (storageProject.dynamicID !== project.dynamicID || storageProject.staticID !== project.staticID) {
            storageProject = new StorageProject(0, project.dynamicID, project.staticID);
            await vscode.workspace.fs.writeFile(projectUri, new TextEncoder().encode(JSON.stringify(storageProject)));
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, "project.collabdynamic"), new Uint8Array());
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, "project.collabstatic"), new Uint8Array());
        }

        return new FileSystem(state, project, storageProject);
    }


    /**
     * @brief Download files from Google Drive to the current folder
    **/
    public async download() : Promise<void> {
        // Checks
        const storageFolder = context.storageUri;
        if (!storageFolder) {
            throw new Error("Download failed : no storage folder");
        }
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Download failed : no folder opened");
        }
        if (!GoogleDrive.Instance) {
            throw new Error("Download failed : not authenticated");
        }

        // Download files if they were changed
        let dynamicFiles;
        if (this.state.dynamicVersion > this.storageProject.version) {
            dynamicFiles = await GoogleDrive.Instance.getDynamic(this.googleDriveProject);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(storageFolder, "project.collabdynamic"), dynamicFiles);
        }
        else {
            dynamicFiles = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(storageFolder, "project.collabdynamic"));
        }
        let staticFiles;
        if (this.state.staticVersion > this.storageProject.version) {
            staticFiles = await GoogleDrive.Instance.getStatic(this.googleDriveProject);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(storageFolder, "project.collabstatic"), staticFiles);
        }
        else {
            staticFiles = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(storageFolder, "project.collabstatic"));
        }

        // Load files in the workspace
        for (const file of new FilesDeserializer(dynamicFiles)) {
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, file.name), file.content);
            const time = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, file.name))).mtime;
            this.previousDynamic.set(file.name, time);
        }
        for (const file of new FilesDeserializer(staticFiles)) {
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, file.name), file.content);
            const time = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, file.name))).mtime;
            this.previousStatic.set(file.name, time);
        }
    }


    /**
     * @brief Upload files from the current folder to Google Drive
     * @param config Configuration for the files to upload
    **/
    public async upload(config: FilesConfig) : Promise<void> {
        // Checks
        const storageFolder = context.storageUri;
        if (!storageFolder) {
            throw new Error("Upload failed : no storage folder");
        }
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Upload failed : no folder opened");
        }
        if (!GoogleDrive.Instance) {
            throw new Error("Upload failed : not authenticated");
        }

        // Check if files were changed
        let newDynamic = new Map<string, number>();
        let dynamicChanged = false;
        let newStatic = new Map<string, number>();
        let staticChanged = false;
        const names = await FileSystem.fileNames(folder);
        for (const name of names) {
            if (name === "/.collablaunch" || match(name, config.ignoreRules)) { // Ignore .collablaunch and ignored files
                continue;
            }

            if (match(name, config.staticRules)) { // Static file
                const lastModified = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, name))).mtime;
                newStatic.set(name, lastModified);
                if (!staticChanged) { // Check if file was changed since last upload
                    const previousLastModified = this.previousStatic.get(name);
                    if (!previousLastModified || lastModified > previousLastModified) {
                        staticChanged = true;
                    }
                }
            }
            else { // Dynamic file
                const lastModified = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, name))).mtime;
                newDynamic.set(name, lastModified);
                if (!dynamicChanged) { // Check if file was changed since last upload
                    const previousLastModified = this.previousDynamic.get(name);
                    if (!previousLastModified || lastModified > previousLastModified) {
                        dynamicChanged = true;
                    }
                }
            }
        }
        for (const name of this.previousDynamic.keys()) {
            if (!newDynamic.has(name)) { // Check if file was deleted since last upload
                dynamicChanged = true;
            }
        }
        for (const name of this.previousStatic.keys()) {
            if (!newStatic.has(name)) { // Check if file was deleted since last upload
                staticChanged = true;
            }
        }
        this.previousDynamic = newDynamic;
        this.previousStatic = newStatic;

        // Upload files if they were changed
        if (dynamicChanged) {
            const serializer = new FilesSerializer();
            for (const name of newDynamic.keys()) {
                serializer.add(name, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, name)));
            }
            const dynamicFiles = serializer.serialize();
            await GoogleDrive.Instance.setDynamic(this.googleDriveProject, dynamicFiles);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(storageFolder, "project.collabdynamic"), dynamicFiles);
            this.state.dynamicVersion = this.storageProject.version + 1;
        }
        if (staticChanged) {
            const serializer = new FilesSerializer();
            for (const name of newStatic.keys()) {
                serializer.add(name, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, name)));
            }
            const staticFiles = serializer.serialize();
            await GoogleDrive.Instance.setStatic(this.googleDriveProject, staticFiles);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(storageFolder, "project.collabstatic"), staticFiles);
            this.state.staticVersion = this.storageProject.version + 1;
        }

        // Increment version if files were changed
        if (dynamicChanged || staticChanged) {
            await GoogleDrive.Instance.setState(this.googleDriveProject, this.state);
            const projectUri = vscode.Uri.joinPath(storageFolder, "project.json");
            this.storageProject.version++;
            await vscode.workspace.fs.writeFile(projectUri, new TextEncoder().encode(JSON.stringify(this.storageProject)));
        }
    }


    /**
     * @brief Clear all files in the current folder
    **/
    public async clear(config: FilesConfig) : Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Clear failed : no folder opened");
        }

        // Delete files
        const names = await FileSystem.fileNames(folder);
        for (const name of names) {
            if (name !== "/.collablaunch" && !match(name, config.ignoreRules)) {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, name));
            }
        }

        // Delete folders
        const files = await vscode.workspace.fs.readDirectory(folder);
        for (const file of files) {
            if (file[1] === vscode.FileType.Directory) {
                if ((await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(folder, file[0]))).length === 0) {
                    await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, file[0]), { recursive: true });
                }
            }
        }
    }


    /**
     * @brief Recursively get the names (with sub-folder names) of all files in a folder
     * @param folder The folder
     * @param subfolder The current sub-folder
    **/
    public static async fileNames(folder: vscode.Uri, subfolder: string = "") : Promise<string[]> {
        let fileNames = [];
        const files = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(folder, subfolder));
        for (const [name, type] of files) {
            if (type === vscode.FileType.File) {
                fileNames.push(subfolder + "/" + name);
            }
            else if (type === vscode.FileType.Directory) {
                fileNames.push(...await FileSystem.fileNames(folder, subfolder + "/" + name));
            }
        }
        return fileNames;
    }

}



class StorageProject {
    public constructor(
        public version: number, 
        public dynamicID: string, 
        public staticID: string
    ) {}
}



export class FilesConfig {
    public staticRules: string[] = ["*.png", "*.jpg", "*.jpeg", "*.pdf", "*.svg"];
    public ignoreRules: string[] = [".vscode/*"];
}