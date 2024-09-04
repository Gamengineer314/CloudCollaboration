import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, ProjectState } from "./GoogleDrive";
import { FilesDeserializer, FilesSerializer } from "./FilesSerialization";
import { match } from "./FileRules";
import { fileUri, recurListFolder, showErrorWrap } from "./util";
import { context, currentFolder } from "./extension";


export class FileSystem {

    private previousDynamic: Map<string, number> = new Map<string, number>(); // key: name, value: last modified time
    private previousStatic: Map<string, number> = new Map<string, number>();
    private createEvent: vscode.Disposable | undefined = undefined;
    private deleteEvent: vscode.Disposable | undefined = undefined;
    private saveEvent: vscode.Disposable | undefined = undefined;
    private renameEvent: vscode.Disposable | undefined = undefined;
    
    private constructor(
        private state: ProjectState, 
        private googleDriveProject: GoogleDriveProject,
        private storageProject: StorageProject,
        private storageFolder: vscode.Uri,
        private projectFolder: vscode.Uri
    ) {}

    public get State() : ProjectState { return this.state; }

    public static copy(fileSystem: FileSystem) : FileSystem {
        return new FileSystem(
            fileSystem.state,
            fileSystem.googleDriveProject,
            fileSystem.storageProject,
            vscode.Uri.parse(fileSystem.storageFolder.path),
            vscode.Uri.parse(fileSystem.projectFolder.path)
        );
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
        if (!GoogleDrive.Instance) {
            throw new Error("Download failed : not authenticated");
        }

        // Download dynamic files if they were changed
        let dynamicFiles;
        if (this.state.dynamicVersion > this.storageProject.version) {
            dynamicFiles = await GoogleDrive.Instance.getDynamic(this.googleDriveProject);
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.collabdynamic"), dynamicFiles);
        }
        else {
            dynamicFiles = await vscode.workspace.fs.readFile(this.storageFileUri("project.collabdynamic"));
        }

        // Download static files if they were changed
        let staticFiles;
        if (this.state.staticVersion > this.storageProject.version) {
            staticFiles = await GoogleDrive.Instance.getStatic(this.googleDriveProject);
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.collabstatic"), staticFiles);
        }
        else {
            staticFiles = await vscode.workspace.fs.readFile(this.storageFileUri("project.collabstatic"));
        }

        // Load files in the project folder
        for (const file of new FilesDeserializer(dynamicFiles)) {
            await vscode.workspace.fs.writeFile(this.projectFileUri(file.name), file.content);
            const time = (await vscode.workspace.fs.stat(this.projectFileUri(file.name))).mtime;
            this.previousDynamic.set(file.name, time);
        }
        for (const file of new FilesDeserializer(staticFiles)) {
            await vscode.workspace.fs.writeFile(this.projectFileUri(file.name), file.content);
            const time = (await vscode.workspace.fs.stat(this.projectFileUri(file.name))).mtime;
            this.previousStatic.set(file.name, time);
        }

        // Load files in the folder
        for (const file of await recurListFolder(this.projectFolder)) {
            await vscode.workspace.fs.writeFile(
                this.toUri(this.projectFileUri(file), folder), 
                await vscode.workspace.fs.readFile(this.projectFileUri(file))
            );
        }

        // Update version
        this.storageProject.version = Math.max(this.state.dynamicVersion, this.state.staticVersion);
        await vscode.workspace.fs.writeFile(this.storageFileUri("project.json"), new TextEncoder().encode(JSON.stringify(this.storageProject)));
    }


    /**
     * @brief Upload files from the current folder to Google Drive
     * @param config Files configuration
    **/
    public async upload(config: FilesConfig) : Promise<void> {
        // Check if files were changed
        let newDynamic = new Map<string, number>();
        let dynamicChanged = false;
        let newStatic = new Map<string, number>();
        let staticChanged = false;
        const names = await recurListFolder(this.projectFolder);
        for (const name of names) {
            if (name === "/.collablaunch" || match(name, config.ignoreRules)) { // Ignore .collablaunch and ignored files
                continue;
            }

            if (match(name, config.staticRules)) { // Static file
                const lastModified = (await vscode.workspace.fs.stat(this.projectFileUri(name))).mtime;
                newStatic.set(name, lastModified);
                if (!staticChanged) { // Check if file was changed since last upload
                    const previousLastModified = this.previousStatic.get(name);
                    if (!previousLastModified || lastModified > previousLastModified) {
                        staticChanged = true;
                    }
                }
            }
            else { // Dynamic file
                const lastModified = (await vscode.workspace.fs.stat(this.projectFileUri(name))).mtime;
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
                serializer.add(name, await vscode.workspace.fs.readFile(this.projectFileUri(name)));
            }
            const dynamicFiles = serializer.serialize();
            await GoogleDrive.Instance.setDynamic(this.googleDriveProject, dynamicFiles);
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.collabdynamic"), dynamicFiles);
            this.state.dynamicVersion = this.storageProject.version + 1;
        }
        if (staticChanged) {
            const serializer = new FilesSerializer();
            for (const name of newStatic.keys()) {
                serializer.add(name, await vscode.workspace.fs.readFile(this.projectFileUri(name)));
            }
            const staticFiles = serializer.serialize();
            await GoogleDrive.Instance.setStatic(this.googleDriveProject, staticFiles);
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.collabstatic"), staticFiles);
            this.state.staticVersion = this.storageProject.version + 1;
        }

        // Increment version if files were changed
        if (dynamicChanged || staticChanged) {
            await GoogleDrive.Instance.setState(this.googleDriveProject, this.state);
            this.storageProject.version++;
            await vscode.workspace.fs.writeFile(this.storageFileUri("project.json"), new TextEncoder().encode(JSON.stringify(this.storageProject)));
        }
    }


    /**
     * @brief Clear all files in the current folder
     * @param config Files configuration
     * @param clearCurrent Wether or not to clear the current folder
    **/
    public async clear(config: FilesConfig, clearCurrent: boolean) : Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Clear failed : no folder opened");
        }

        // Delete files from project folder
        const deleteEdit = new vscode.WorkspaceEdit();
        for (const file of await recurListFolder(this.projectFolder)) {
            if (file !== "/.collablaunch" && !match(file, config.ignoreRules)) {
                deleteEdit.deleteFile(this.projectFileUri(file));
            }
        }

        // Delete all files from current folder
        if (clearCurrent) {
            for (const file of await vscode.workspace.fs.readDirectory(currentFolder)) {
                if (file[0] !== ".collablaunch") {
                    deleteEdit.deleteFile(fileUri(file[0]), { recursive: true });
                }
            }
        }
        await vscode.workspace.applyEdit(deleteEdit);

        // Delete folders from project folder
        for (const folder of await recurListFolder(this.projectFolder, vscode.FileType.Directory)) {
            if ((await vscode.workspace.fs.readDirectory(this.projectFileUri(folder))).length === 0) {
                await vscode.workspace.fs.delete(this.projectFileUri(folder));
            }
        }
    }


    /**
     * @brief Start synchronization between the current folder and the project folder
     * @param currentToProject Wether or not to copy files in the current folder to the project folder
    **/
    public async startSync(currentToProject: boolean) : Promise<void> {
        // Copy files in the current folder to the project folder
        if (currentToProject) {
            for (const file of await recurListFolder()) {
                const uri = fileUri(file);
                await vscode.workspace.fs.copy(uri, this.toProjectUri(uri), { overwrite: true });
            }
        }

        // Listen to file modification events
        this.createEvent = vscode.workspace.onDidCreateFiles(showErrorWrap(async (event: vscode.FileCreateEvent) => {
            for (const file of event.files) {
                await vscode.workspace.fs.copy(file, this.toProjectUri(file));
            }
        }));
        this.deleteEvent = vscode.workspace.onDidDeleteFiles(showErrorWrap(async (event: vscode.FileDeleteEvent) => {
            for (const file of event.files) {
                await vscode.workspace.fs.delete(this.toProjectUri(file));
            }
        }));
        this.saveEvent = vscode.workspace.onDidSaveTextDocument(showErrorWrap(async (document: vscode.TextDocument) => {
            if (!document.uri.path.endsWith("Visual Studio Live Share.code-workspace")) { // Ignore weird Live Share documents
                await vscode.workspace.fs.copy(document.uri, this.toProjectUri(document.uri), { overwrite: true });
            }
        }));
        this.renameEvent = vscode.workspace.onDidRenameFiles(showErrorWrap(async (event: vscode.FileRenameEvent) => {
            for (const file of event.files) {
                await vscode.workspace.fs.rename(this.toProjectUri(file.oldUri), this.toProjectUri(file.newUri));
            }
        }));
    }


    /**
     * @brief Stop synchronization between the current folder and the project folder
    **/
    public stopSync() : void {
        this.createEvent?.dispose();
        this.deleteEvent?.dispose();
        this.saveEvent?.dispose();
        this.renameEvent?.dispose();
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

    /**
     * @brief Get the URI of a file in the project folder from a URI in the current folder
     * @param uri URI of the file in the current folder
     * @returns URI of the file in the project folder
    **/
    private toProjectUri(uri: vscode.Uri) : vscode.Uri {
        return this.projectFileUri(uri.path.substring(currentFolder.path.length));
    }

    /**
     * @brief Get the URI of a file in a folder from a URI in the project folder
     * @param uri URI of the file in the project folder
     * @param folder The folder (default: current folder)
     * @returns URI of the file in the current folder
    **/
    private toUri(uri: vscode.Uri, folder: vscode.Uri | null = null) : vscode.Uri {
        return fileUri(uri.path.substring(this.projectFolder.path.length), folder);
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