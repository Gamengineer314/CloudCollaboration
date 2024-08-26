import * as vscode from "vscode";
import { GoogleDrive, GoogleDriveProject, ProjectState } from "./GoogleDrive";
import { context } from "./extension";
import { FilesDeserializer, FilesSerializer } from "./FilesSerialization";


export class FileSystem {

    private dynamicNames: Set<string> = new Set<string>();
    private staticNames: Set<string> = new Set<string>();
    
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
            this.dynamicNames.add(file.name);
        }
        for (const file of new FilesDeserializer(staticFiles)) {
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, file.name), file.content);
            this.staticNames.add(file.name);
        }

        // Write project.json to update last modified time
        const projectUri = vscode.Uri.joinPath(storageFolder, "project.json");
        await vscode.workspace.fs.writeFile(projectUri, new TextEncoder().encode(JSON.stringify(this.storageProject)));
    }


    /**
     * @brief Upload files from the current folder to Google Drive
    **/
    public async upload() : Promise<void> {
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

        // Increment version
        const projectUri = vscode.Uri.joinPath(storageFolder, "project.json");
        const lastUpload = (await vscode.workspace.fs.stat(projectUri)).mtime;
        this.storageProject.version++;
        await vscode.workspace.fs.writeFile(projectUri, new TextEncoder().encode(JSON.stringify(this.storageProject)));

        // Check if files were changed
        let dynamicChanged = false;
        let newDynamicNames = new Set<string>();
        let staticChanged = false;
        let newStaticNames = new Set<string>();
        const names = await FileSystem.fileNames(folder);
        for (const name of names) {
            if (name === "/.collablaunch") { // Ignore .collablaunch file
                continue;
            }

            //if () { // Dynamic file
                newDynamicNames.add(name);
                if (!dynamicChanged) { // Check if file was changed since last upload
                    const lastModified = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, name))).mtime;
                    if (lastModified > lastUpload) {
                        dynamicChanged = true;
                    }
                }
            /*}
            else { // Static file
                newStaticNames.add(name);
                if (!staticChanged) { // Check if file was changed since last upload
                    const lastModified = (await vscode.workspace.fs.stat(vscode.Uri.joinPath(folder, name))).mtime;
                    if (lastModified > lastUpload) {
                        staticChanged = true;
                    }
                }
            }*/
        }
        for (const name of this.dynamicNames) {
            if (!newDynamicNames.has(name)) { // Check if file was deleted since last upload
                dynamicChanged = true;
            }
        }
        for (const name of this.staticNames) {
            if (!newStaticNames.has(name)) { // Check if file was deleted since last upload
                staticChanged = true;
            }
        }
        this.dynamicNames = newDynamicNames;
        this.staticNames = newStaticNames;

        // Upload files if they were changed
        if (dynamicChanged) {
            const serializer = new FilesSerializer();
            for (const name of newDynamicNames) {
                serializer.add(name, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, name)));
            }
            const dynamicFiles = serializer.serialize();
            await GoogleDrive.Instance.setDynamic(this.googleDriveProject, dynamicFiles);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(storageFolder, "project.collabdynamic"), dynamicFiles);
            this.state.dynamicVersion = this.storageProject.version;
        }
        if (staticChanged) {
            const serializer = new FilesSerializer();
            for (const name of newStaticNames) {
                serializer.add(name, await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder, name)));
            }
            const staticFiles = serializer.serialize();
            await GoogleDrive.Instance.setStatic(this.googleDriveProject, staticFiles);
            await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(storageFolder, "project.collabstatic"), staticFiles);
            this.state.staticVersion = this.storageProject.version;
        }
        if (dynamicChanged || staticChanged) {
            await GoogleDrive.Instance.setState(this.googleDriveProject, this.state);
        }
    }


    /**
     * @brief Clear all files in the current folder
    **/
    public async clear() : Promise<void> {
        const folder = vscode.workspace.workspaceFolders?.[0].uri;
        if (!folder) {
            throw new Error("Clear failed : no folder opened");
        }
        const files = await vscode.workspace.fs.readDirectory(folder);
        for (const file of files) {
            if (file[0] !== ".collablaunch") {
                await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, file[0]), { recursive: true });
            }
        }
    }


    /**
     * @brief Recursively get the names (with sub-folder names) of all files in a folder
     * @param folder The folder
     * @param subfolder The current sub-folder
    **/
    private static async fileNames(folder: vscode.Uri, subfolder: string = "") : Promise<string[]> {
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
    public staticRules: string[] = [];
    public dynamicRules: string[] = [];
}