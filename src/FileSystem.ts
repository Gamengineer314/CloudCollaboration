import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, ProjectState } from "./GoogleDrive";
import { FilesDeserializer, FilesSerializer } from "./FilesSerialization";
import { match } from "./FileRules";
import { fileUri, recurListFolder } from "./util";
import { context, currentFolder } from "./extension";


export class FileSystem {

    private previousDynamic: Map<string, number> = new Map<string, number>(); // key: name, value: last modified time
    private previousStatic: Map<string, number> = new Map<string, number>();
    
    private constructor(
        private state: ProjectState, 
        private googleDriveProject: GoogleDriveProject,
        private storageProject: StorageProject,
        private storageFolder: vscode.Uri,
        private projectFolder: vscode.Uri
    ) {}

    public get State() : ProjectState { return this.state; }

    public static copy(fileSystem: FileSystem) : FileSystem {
        return new FileSystem(fileSystem.state, fileSystem.googleDriveProject, fileSystem.storageProject, fileSystem.storageFolder, fileSystem.projectFolder);
    }


    /**
     * @brief Initialize a new file system for a project
     * @param project The project
     * @param state Initial state of the project
    **/
    public static async init(project: GoogleDriveProject, state: ProjectState) : Promise<FileSystem> {
        // Storage folders
        const storageFolder = context.storageUri;
        if (!storageFolder) {
            throw new Error("FileSystem initialization failed : no storage folder");
        }
        const projectFolder = fileUri("Project", storageFolder);

        // Default files for new projects
        let storageProject;
        try {
            storageProject = JSON.parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(fileUri("project.json", storageFolder))));
        }
        catch {
            storageProject = new StorageProject(0, "", "");
            await vscode.workspace.fs.createDirectory(projectFolder);
        }
        if (storageProject.dynamicID !== project.dynamicID || storageProject.staticID !== project.staticID) {
            storageProject = new StorageProject(0, project.dynamicID, project.staticID);
            await vscode.workspace.fs.writeFile(fileUri("project.json", storageFolder), new TextEncoder().encode(JSON.stringify(storageProject)));
            await vscode.workspace.fs.writeFile(fileUri("project.collabdynamic", storageFolder), new Uint8Array());
            await vscode.workspace.fs.writeFile(fileUri("project.collabstatic", storageFolder), new Uint8Array());
            for (const file of await recurListFolder(projectFolder)) {
                await vscode.workspace.fs.delete(fileUri(file, projectFolder));
            }
        }

        return new FileSystem(state, project, storageProject, storageFolder, projectFolder);
    }


    /**
     * @brief Download files from Google Drive to a given folder
     * @param folder The folder (default: current folder)
    **/
    public async download(folder: vscode.Uri | null = null) : Promise<void> {
        // Download files if they were changed
        if (!GoogleDrive.Instance) {
            throw new Error("Download failed : not authenticated");
        }
        let dynamicFiles;
        if (this.state.dynamicVersion > this.storageProject.version) {
            dynamicFiles = await GoogleDrive.Instance.getDynamic(this.googleDriveProject);
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.collabdynamic"), dynamicFiles);
        }
        else {
            dynamicFiles = await vscode.workspace.fs.readFile(this.storageFileUri("project.collabdynamic"));
        }
        let staticFiles;
        if (this.state.staticVersion > this.storageProject.version) {
            staticFiles = await GoogleDrive.Instance.getStatic(this.googleDriveProject);
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.collabstatic"), staticFiles);
        }
        else {
            staticFiles = await vscode.workspace.fs.readFile(this.storageFileUri("project.collabstatic"));
        }

        // Load files in the folder
        for (const file of new FilesDeserializer(dynamicFiles)) {
            await vscode.workspace.fs.writeFile(fileUri(file.name, folder), file.content);
            const time = (await vscode.workspace.fs.stat(fileUri(file.name, folder))).mtime;
            this.previousDynamic.set(file.name, time);
        }
        for (const file of new FilesDeserializer(staticFiles)) {
            await vscode.workspace.fs.writeFile(fileUri(file.name, folder), file.content);
            const time = (await vscode.workspace.fs.stat(fileUri(file.name, folder))).mtime;
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
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.collabdynamic"), dynamicFiles);
            this.state.dynamicVersion = this.storageProject.version + 1;
        }
        if (staticChanged) {
            const serializer = new FilesSerializer();
            for (const name of newStatic.keys()) {
                serializer.add(name, await vscode.workspace.fs.readFile(fileUri(name)));
            }
            const staticFiles = serializer.serialize();
            await GoogleDrive.Instance.setStatic(this.googleDriveProject, staticFiles);
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.collabstatic"), staticFiles);
            this.state.staticVersion = this.storageProject.version + 1;
        }

        // Increment version if files were changed
        if (dynamicChanged || staticChanged) {
            await GoogleDrive.Instance.setState(this.googleDriveProject, this.state);
            const projectUri = this.storageFileUri("project.json");
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
        const deleteEdit = new vscode.WorkspaceEdit();
        const files = await recurListFolder();
        for (const file of files) {
            if (file !== "/.collablaunch" && !match(file, config.ignoreRules)) {
                //await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, name));
                deleteEdit.deleteFile(fileUri(file));
            }
        }
        await vscode.workspace.applyEdit(deleteEdit);

        // Delete folders
        const folders = await recurListFolder(currentFolder, vscode.FileType.Directory);
        for (const folder of folders) {
            if ((await vscode.workspace.fs.readDirectory(fileUri(folder))).length === 0) {
                await vscode.workspace.fs.delete(fileUri(folder));
            }
        }
    }


    /**
     * @brief Open a terminal in the project folder
    **/
    public async openProjectTerminal() : Promise<void> {
        await vscode.commands.executeCommand("workbench.action.terminal.newWithCwd", { cwd: this.projectFolder.path });
    }


    /**
     * @brief Get the URI of a file in the storage folder
     * @param fileName Name of the file
     * @returns 
    **/
    private storageFileUri(fileName: string) : vscode.Uri {
        return fileUri(fileName, this.storageFolder);
    }

    /**
     * @brief Get the URI of a file in the project folder
     * @param fileName Name of the file
     * @returns 
    **/
    private projectFileUri(name: string) : vscode.Uri {
        return fileUri(name, this.projectFolder);
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
    public staticRules: string[] = ["**.png", "**.jpg", "**.jpeg", "**.pdf", "**.svg"];
    public ignoreRules: string[] = [".vscode/**"];
}