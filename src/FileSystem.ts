import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, ProjectState } from "./GoogleDrive";
import { fileUri, storageFileUri, recurListFolder } from "./extension";
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
        let storageProject;
        try {
            storageProject = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(storageFileUri("project.json"))));
        }
        catch {
            storageProject = new StorageProject(0, "", "");
        }
        if (storageProject.dynamicID !== project.dynamicID || storageProject.staticID !== project.staticID) {
            storageProject = new StorageProject(0, project.dynamicID, project.staticID);
            await vscode.workspace.fs.writeFile(storageFileUri("project.json"), new TextEncoder().encode(JSON.stringify(storageProject)));
            await vscode.workspace.fs.writeFile(storageFileUri("project.collabdynamic"), new Uint8Array());
            await vscode.workspace.fs.writeFile(storageFileUri("project.collabstatic"), new Uint8Array());
        }

        return new FileSystem(state, project, storageProject);
    }


    /**
     * @brief Download files from Google Drive to the current folder
    **/
    public async download() : Promise<void> {
        // Download files if they were changed
        if (!GoogleDrive.Instance) {
            throw new Error("Download failed : not authenticated");
        }
        let dynamicFiles;
        if (this.state.dynamicVersion > this.storageProject.version) {
            dynamicFiles = await GoogleDrive.Instance.getDynamic(this.googleDriveProject);
            await vscode.workspace.fs.writeFile(storageFileUri("project.collabdynamic"), dynamicFiles);
        }
        else {
            dynamicFiles = await vscode.workspace.fs.readFile(storageFileUri("project.collabdynamic"));
        }
        let staticFiles;
        if (this.state.staticVersion > this.storageProject.version) {
            staticFiles = await GoogleDrive.Instance.getStatic(this.googleDriveProject);
            await vscode.workspace.fs.writeFile(storageFileUri("project.collabstatic"), staticFiles);
        }
        else {
            staticFiles = await vscode.workspace.fs.readFile(storageFileUri("project.collabstatic"));
        }

        // Load files in the workspace
        for (const file of new FilesDeserializer(dynamicFiles)) {
            await vscode.workspace.fs.writeFile(fileUri(file.name), file.content);
            const time = (await vscode.workspace.fs.stat(fileUri(file.name))).mtime;
            this.previousDynamic.set(file.name, time);
        }
        for (const file of new FilesDeserializer(staticFiles)) {
            await vscode.workspace.fs.writeFile(fileUri(file.name), file.content);
            const time = (await vscode.workspace.fs.stat(fileUri(file.name))).mtime;
            this.previousStatic.set(file.name, time);
        }
    }


    /**
     * @brief Upload files from the current folder to Google Drive
     * @param config Configuration for the files to upload
    **/
    public async upload(config: FilesConfig) : Promise<void> {
        // Check if files were changed
        let newDynamic = new Map<string, number>();
        let dynamicChanged = false;
        let newStatic = new Map<string, number>();
        let staticChanged = false;
        const names = await recurListFolder();
        for (const name of names) {
            if (name === "/.collablaunch" || match(name, config.ignoreRules)) { // Ignore .collablaunch and ignored files
                continue;
            }

            if (match(name, config.staticRules)) { // Static file
                const lastModified = (await vscode.workspace.fs.stat(fileUri(name))).mtime;
                newStatic.set(name, lastModified);
                if (!staticChanged) { // Check if file was changed since last upload
                    const previousLastModified = this.previousStatic.get(name);
                    if (!previousLastModified || lastModified > previousLastModified) {
                        staticChanged = true;
                    }
                }
            }
            else { // Dynamic file
                const lastModified = (await vscode.workspace.fs.stat(fileUri(name))).mtime;
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
        if (!GoogleDrive.Instance) {
            throw new Error("Upload failed : not authenticated");
        }
        if (dynamicChanged) {
            const serializer = new FilesSerializer();
            for (const name of newDynamic.keys()) {
                serializer.add(name, await vscode.workspace.fs.readFile(fileUri(name)));
            }
            const dynamicFiles = serializer.serialize();
            await GoogleDrive.Instance.setDynamic(this.googleDriveProject, dynamicFiles);
            await vscode.workspace.fs.writeFile(storageFileUri("project.collabdynamic"), dynamicFiles);
            this.state.dynamicVersion = this.storageProject.version + 1;
        }
        if (staticChanged) {
            const serializer = new FilesSerializer();
            for (const name of newStatic.keys()) {
                serializer.add(name, await vscode.workspace.fs.readFile(fileUri(name)));
            }
            const staticFiles = serializer.serialize();
            await GoogleDrive.Instance.setStatic(this.googleDriveProject, staticFiles);
            await vscode.workspace.fs.writeFile(storageFileUri("project.collabstatic"), staticFiles);
            this.state.staticVersion = this.storageProject.version + 1;
        }

        // Increment version if files were changed
        if (dynamicChanged || staticChanged) {
            await GoogleDrive.Instance.setState(this.googleDriveProject, this.state);
            const projectUri = storageFileUri("project.json");
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
        const names = await recurListFolder();
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