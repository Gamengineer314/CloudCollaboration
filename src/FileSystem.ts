import * as vscode from "vscode";
import { Project } from "./Project";
import { GoogleDrive, DriveProject, ProjectState } from "./GoogleDrive";
import { FilesDeserializer, FilesSerializer } from "./FilesSerialization";
import { match } from "./FileRules";
import { isBinary, toBase64, fromBase64 } from "./BinaryFiles";
import { collaborationUri, collaborationName, collaborationRecurListFolder, fileUri, recurListFolder, showErrorWrap, log } from "./util";
import { context, collaborationFolder } from "./extension";


export class FileSystem {

    private files : Map<string, FileState> = new Map<string, FileState>();
    private filesContent : Map<string, FileContent> = new Map<string, FileContent>();
    private previousDynamic : Set<string> = new Set<string>();
    private previousStatic : Set<string> = new Set<string>();
    private binaryFiles : Set<string> = new Set<string>(); // Name of all binary files
    private createdFiles : Set<string> = new Set<string>(); // Name of the files that were just created by the user
    private backupCount : number = -1;
    private synchronizing : boolean = false;
    private onUpdateConfig: () => void | Promise<void> = () => {};
    private syncDisposables : vscode.Disposable[] = [];
    
    private constructor(
        private state: ProjectState,
        private driveProject: DriveProject,
        private storageProject: StorageProject,
        private _storageFolder: vscode.Uri,
        private _projectFolder: vscode.Uri
    ) {}

    public get storageFolder() : vscode.Uri { return this._storageFolder; }
    public get projectFolder() : vscode.Uri { return this._projectFolder; }
    public get backupPath() : string { return this.storageUri("Backups").fsPath; }

    public static copy(fileSystem: FileSystem, state: ProjectState) : FileSystem {
        return new FileSystem(
            state,
            fileSystem.driveProject,
            fileSystem.storageProject,
            vscode.Uri.parse(fileSystem._storageFolder.path),
            vscode.Uri.parse(fileSystem._projectFolder.path)
        );
    }


    /**
     * @brief Initialize a new file system for a project
     * @param project The project
     * @param state Initial state of the project
    **/
    public static async init(project: DriveProject, state: ProjectState) : Promise<FileSystem> {
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
        }
        if (storageProject.dynamicID !== project.dynamicID || storageProject.staticID !== project.staticID) {
            storageProject = new StorageProject(0, project.dynamicID, project.staticID);
            await vscode.workspace.fs.createDirectory(projectFolder);
            await vscode.workspace.fs.createDirectory(fileUri("Backups", storageFolder));
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
     * @brief Download files from Google Drive to the project and current folders
    **/
    public async download() : Promise<void> {
        log("Download");
        await vscode.workspace.fs.writeFile(this.storageUri("garbageMarker"), new Uint8Array());

        // Download dynamic files if they were changed
        let dynamicFiles;
        if (this.state.dynamicVersion > this.storageProject.version) {
            log("Dynamic changed");
            dynamicFiles = await GoogleDrive.instance!.getDynamic(this.driveProject);
            await vscode.workspace.fs.writeFile(this.storageUri("project.collabdynamic"), dynamicFiles);
        }
        else {
            dynamicFiles = await vscode.workspace.fs.readFile(this.storageUri("project.collabdynamic"));
        }

        // Download static files if they were changed
        let staticFiles;
        if (this.state.staticVersion > this.storageProject.version) {
            log("Static changed");
            staticFiles = await GoogleDrive.instance!.getStatic(this.driveProject);
            await vscode.workspace.fs.writeFile(this.storageUri("project.collabstatic"), staticFiles);
        }
        else {
            staticFiles = await vscode.workspace.fs.readFile(this.storageUri("project.collabstatic"));
        }

        // Load files in the project folder
        for (const file of new FilesDeserializer(dynamicFiles)) {
            if (file.name.endsWith(".collab64")) {
                file.name = file.name.substring(0, file.name.length - 9);
                this.binaryFiles.add(file.name);
            }
            await vscode.workspace.fs.writeFile(this.projectUri(file.name), file.content);
            this.previousDynamic.add(file.name);
        }
        for (const file of new FilesDeserializer(staticFiles)) {
            if (file.name.endsWith(".collab64")) {
                file.name = file.name.substring(0, file.name.length - 9);
                this.binaryFiles.add(file.name);
            }
            await vscode.workspace.fs.writeFile(this.projectUri(file.name), file.content);
            this.previousStatic.add(file.name);
        }

        // Load files in the folder
        for (const file of await recurListFolder(this.projectFolder)) {
            let content = await vscode.workspace.fs.readFile(this.projectUri(file));
            const state = new FileState();
            state.content = content;
            this.files.set(file, state);
            this.filesContent.set(file, new FileContent(content, false));
            if (this.binaryFiles.has(file)) {
                content = new TextEncoder().encode(toBase64(content));
            }
            await vscode.workspace.fs.writeFile(
                collaborationUri(this.toCollabName(file)),
                content
            );
        }

        // Update version
        this.storageProject.version = Math.max(this.state.dynamicVersion, this.state.staticVersion);
        await vscode.workspace.fs.writeFile(this.storageUri("project.json"), new TextEncoder().encode(JSON.stringify(this.storageProject)));
    }


    /**
     * @brief Upload files from the project folder to Google Drive
     * @param config Files configuration
     * @param clearUrl Wether or not to clear the URL in the state (default: false)
     * @param uploadOnly Wether or not to only upload and not also write locally and in backups (default: false)
    **/
    public async upload(config: FilesConfig, clearUrl: boolean = false, uploadOnly: boolean = false) : Promise<void> {
        log("Upload");

        // Check if files were changed
        let newDynamic = new Set<string>();
        let dynamicChanged = false;
        let dynamicFiles: [string, Uint8Array][] = [];
        let newStatic = new Set<string>();
        let staticChanged = false;
        let staticFiles: [string, Uint8Array][] = [];
        for (const [name, content] of this.filesContent) {
            if (match(name, config.ignoreRules)) { // Ignore ignored files
                continue;
            }

            if (match(name, config.staticRules)) { // Static file
                newStatic.add(name);
                staticFiles.push([name, content.content]);
                if (!staticChanged) { // Check if file was changed since last upload
                    if (content.modified || !this.previousStatic.has(name)) {
                        staticChanged = true;
                    }
                }
            }
            else { // Dynamic file
                newDynamic.add(name);
                dynamicFiles.push([name, content.content]);
                if (!dynamicChanged) { // Check if file was changed since last upload
                    if (content.modified || !this.previousDynamic.has(name)) {
                        dynamicChanged = true;
                    }
                }
            }
            content.modified = false;
        }
        for (const name of this.previousDynamic) {
            if (!newDynamic.has(name)) { // Check if file was deleted since last upload
                dynamicChanged = true;
            }
        }
        for (const name of this.previousStatic) {
            if (!newStatic.has(name)) { // Check if file was deleted since last upload
                staticChanged = true;
            }
        }
        this.previousDynamic = newDynamic;
        this.previousStatic = newStatic;

        // Upload files if they were changed
        if (dynamicChanged) {
            log("Dynamic changed");
            const serializer = new FilesSerializer();
            for (const [name, content] of dynamicFiles) {
                serializer.add(this.toCollabName(name), content);
            }
            const serializedFiles = serializer.get();
            await GoogleDrive.instance!.setDynamic(this.driveProject, serializedFiles);
            if (!uploadOnly) {
                await vscode.workspace.fs.writeFile(this.storageUri("project.collabdynamic"), serializedFiles);
            }
            this.state.dynamicVersion = this.storageProject.version + 1;
        }
        if (staticChanged) {
            log("Static changed");
            const serializer = new FilesSerializer();
            for (const [name, content] of staticFiles) {
                serializer.add(this.toCollabName(name), content);
            }
            const serializedFiles = serializer.get();
            await GoogleDrive.instance!.setStatic(this.driveProject, serializedFiles);
            if (!uploadOnly) {
                await vscode.workspace.fs.writeFile(this.storageUri("project.collabstatic"), serializedFiles);
            }
            this.state.staticVersion = this.storageProject.version + 1;
        }

        // Clear URL
        if (clearUrl) {
            this.state.url = "";
            if (!dynamicChanged && !staticChanged) {
                await GoogleDrive.instance!.setState(this.driveProject, this.state);
            }
        }

        if (dynamicChanged || staticChanged) {
            // Increment version if files were changed
            await GoogleDrive.instance!.setState(this.driveProject, this.state);
            if (!uploadOnly) {
                this.storageProject.version++;
                await vscode.workspace.fs.writeFile(this.storageUri("project.json"), new TextEncoder().encode(JSON.stringify(this.storageProject)));
            }

            // Backup
            if (!uploadOnly && this.backupCount === -1) {
                log("Backup");
                this.backupCount = 0;
                const backupsUri = this.storageUri("Backups");
                const backups = (await vscode.workspace.fs.readDirectory(backupsUri)).map(file => file[0]).sort();
                if (backups.length >= config.maximumBackups) {
                    await vscode.workspace.fs.delete(fileUri(backups[0], backupsUri), { recursive: true });
                }
                const backupUri = fileUri("Backup" + this.storageProject.version, backupsUri);
                await vscode.workspace.fs.createDirectory(backupUri);
                for (const [name, content] of dynamicFiles) {
                    await vscode.workspace.fs.writeFile(fileUri(name, backupUri), content);
                }
                for (const [name, content] of staticFiles) {
                    await vscode.workspace.fs.writeFile(fileUri(name, backupUri), content);
                }
            }
        }

        // Backup frequency
        if (!uploadOnly && this.backupCount !== -1) {
            this.backupCount++;
            if (this.backupCount === config.backupFrequency) {
                this.backupCount = -1;
            }
        }

        log("End upload");
    }


    /**
     * @brief Clear all project files
     * @param config Files configuration
     * @param clearCollaboration Wether or not to clear the collaboration folder
    **/
    public async clear(config: FilesConfig, clearCollaboration: boolean) : Promise<void> {
        // Delete files from project folder
        for (const file of await recurListFolder(this.projectFolder)) {
            if (!match(file, config.ignoreRules)) {
                vscode.workspace.fs.delete(this.projectUri(file));
            }
        }

        // Delete folders from project folder
        for (const folder of await recurListFolder(this.projectFolder, vscode.FileType.Directory)) {
            if ((await vscode.workspace.fs.readDirectory(this.projectUri(folder))).length === 0) {
                await vscode.workspace.fs.delete(this.projectUri(folder));
            }
        }

        // Delete all files from collaboration folder
        if (clearCollaboration) {
            const deleteEdit = new vscode.WorkspaceEdit();
            for (const file of await vscode.workspace.fs.readDirectory(collaborationFolder)) {
                deleteEdit.deleteFile(collaborationUri(file[0]), { recursive: true });
            }
            await vscode.workspace.applyEdit(deleteEdit);
        }

        await vscode.workspace.fs.delete(this.storageUri("garbageMarker"));
    }


    /**
     * @brief Clear files that were not cleared last time in the current and project folders
    **/
    public static async clearGarbage() : Promise<void> {
        // Storage folders
        const storageFolder = context.storageUri;
        if (!storageFolder) {
            throw new Error("FileSystem initialization failed : no storage folder");
        }
        const projectFolder = fileUri("Project", storageFolder);

        // Check if there are files to clear
        try {
            await vscode.workspace.fs.stat(fileUri("garbageMarker", storageFolder));
        }
        catch {
            return;
        }

        // Clear files
        log("Clear garbage");
        const fileSystem = new FileSystem(new ProjectState(), new DriveProject("", "", "", "", ""), new StorageProject(0, "", ""), storageFolder, projectFolder);
        await fileSystem.clear(new FilesConfig(), true);
    }


    /**
     * @brief Start synchronization between the collaboration folder and the project folder
     * @param host Wether or not the current user is the host of the Live Share session
    **/
    public async startSync(host: boolean, onUpdateConfig: () => void | Promise<void> = () => {}) : Promise<void> {
        if (this.synchronizing) {
            throw new Error("Already synchronizing");
        }

        // Copy files from the collaboration folder to the project folder
        if (!host) {
            await vscode.workspace.fs.writeFile(this.storageUri("garbageMarker"), new Uint8Array());
            for (const file of await vscode.workspace.fs.readDirectory(this.projectFolder)) {
                await vscode.workspace.fs.delete(this.projectUri(file[0]), { recursive: true });
            }
            for (let file of await collaborationRecurListFolder()) {
                const collabUri = collaborationUri(file);
                let content = await vscode.workspace.fs.readFile(collabUri);
                if (file.endsWith(".collab64")) {
                    file = file.substring(0, file.length - 9);
                    this.binaryFiles.add(file);
                    content = fromBase64(new TextDecoder().decode(content));
                }
                await vscode.workspace.fs.writeFile(this.projectUri(file), content);
            }
        }

        // Listen to file modification events (collaboration folder -> project folder)
        const collaborationModified = showErrorWrap(this.collaborationFileModified.bind(this, false));
        const collaborationCreated = showErrorWrap(this.collaborationFileModified.bind(this, true));
        const collaborationWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(collaborationFolder, "**"));
        this.syncDisposables.push(collaborationWatcher.onDidCreate(collaborationCreated));
        this.syncDisposables.push(collaborationWatcher.onDidDelete(collaborationModified));
        this.syncDisposables.push(collaborationWatcher.onDidChange(collaborationModified));
        this.syncDisposables.push(collaborationWatcher);
        if (!host) { // Double listening because some events are not triggered in some situations in Live Share
            this.syncDisposables.push(vscode.workspace.onDidCreateFiles(event => {
                for (const uri of event.files) {
                    if (uri.path.startsWith(collaborationFolder.path)) {
                        collaborationCreated(uri);
                    }
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidDeleteFiles(event => {
                for (const uri of event.files) {
                    if (uri.path.startsWith(collaborationFolder.path)) {
                        collaborationModified(uri);
                    }
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidSaveTextDocument(document => {
                if (document.uri.path.startsWith(collaborationFolder.path)) {
                    collaborationModified(document.uri);
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidRenameFiles(event => {
                for (const uri of event.files) {
                    if (uri.oldUri.path.startsWith(collaborationFolder.path)) {
                        collaborationModified(uri.oldUri);
                    }
                    if (uri.newUri.path.startsWith(collaborationFolder.path)) {
                        collaborationCreated(uri.newUri);
                    }
                }
            }));
        }

        // Listen to file modification events (project folder -> collaboration folder)
        const projectModified = showErrorWrap(this.projectFileModified.bind(this, false));
        const projectCreated = showErrorWrap(this.projectFileModified.bind(this, true));
        const projectWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(this.projectFolder, "**"));
        this.syncDisposables.push(projectWatcher.onDidCreate(projectCreated));
        this.syncDisposables.push(projectWatcher.onDidDelete(projectModified));
        this.syncDisposables.push(projectWatcher.onDidChange(projectModified));
        this.syncDisposables.push(projectWatcher);

        // Auto-save modifications made by the extension in the collaboration folder
        this.syncDisposables.push(vscode.workspace.onDidChangeTextDocument(showErrorWrap((event: vscode.TextDocumentChangeEvent) => {
            if (event.contentChanges.length > 0) {
                const name = this.toProjectName(collaborationName(event.document.uri));
                const state = this.files.get(name);
                if (state && state.autoSave) {
                    log("Save " + name);
                    setTimeout(async () => {
                        await event.document.save();
                        log("Saved " + name);
                        if (state.saveResolve) {
                            state.saveResolve();
                            state.saveResolve = null;
                        }
                    }, 100);
                }
            }
        })));
        
        // Get files created by the user
        this.syncDisposables.push(vscode.workspace.onWillCreateFiles(showErrorWrap(async (event: vscode.FileWillCreateEvent) => {
            for (const file of event.files) {
                this.createdFiles.add(collaborationName(file));
            }
        })));

        this.synchronizing = true;
        this.onUpdateConfig = onUpdateConfig;
    }


    /**
     * @brief Handle a file modification (create/modify/delete) in the collaboration folder
     * @param create Wether or not the file was created
     * @param uri Uri of the file
    **/
    private async collaborationFileModified(create: boolean, uri: vscode.Uri) : Promise<void> {
        // Get file state
        const collabName = collaborationName(uri);
        const projectName = this.toProjectName(collabName);
        let state = this.files.get(projectName);
        if (!state) {
            state = new FileState();
            this.files.set(projectName, state);
        }
        log("Collaboration modified " + projectName);

        // Check if already modifying
        if (state.projectModifying) {
            log("Project modifying " + projectName);
            return;
        }
        if (state.collaborationModifying) {
            log("Collaboration already modifying " + projectName);
            state.continue = true;
            return;
        }
        state.collaborationModifying = true;

        // Check if this user created the file
        const creator = this.createdFiles.has(collabName);
        this.createdFiles.delete(collabName);

        // Modify project file while collaboration file is modified
        do {
            state.continue = false;

            // Get content, file type and wether or not the file was deleted
            let content: Uint8Array | null | undefined;
            let directory: boolean;
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.File) {
                    log("File " + projectName);
                    content = await vscode.workspace.fs.readFile(uri);
                    if (collabName.endsWith(".collab64")) { // Binary file -> decode base64
                        content = fromBase64(new TextDecoder().decode(content));
                    }
                    log("Content " + content.length + " " + projectName);
                    directory = false;
                }
                else if (stat.type === vscode.FileType.Directory) {
                    log("Directory " + projectName);
                    content = undefined;
                    directory = true;
                }
                else {
                    throw new Error("Synchronization failed : unsupported file type : " + stat.type);
                }
            }
            catch { // File was deleted
                log("Deleted " + projectName);
                content = null;
                directory = false;
            }

            // Modify project file if content was modified
            if (this.wasModified(state.content, content)) {
                state.content = content;
                if (content) {
                    if (directory) {
                        log("Create project directory " + projectName);
                        await vscode.workspace.fs.createDirectory(this.projectUri(projectName));
                    }
                    else {
                        log("Create/modify project file " + projectName);
                        if (create) {
                            create = false;
                            if (collabName.endsWith(".collab64")) { // Binary file -> add to binary files
                                this.binaryFiles.add(projectName);
                            }
                            else if (creator && isBinary(content)) { // Shouldn't be binary
                                vscode.window.showErrorMessage("Binary files must be added with the 'Upload files' command", "Upload files")
                                .then(showErrorWrap(async (item: string | undefined) => {
                                    if (item) {
                                        await Project.instance?.uploadFiles(collaborationFolder);
                                    }
                                }));
                                state.content = null;
                                const edit = new vscode.WorkspaceEdit();
                                edit.deleteFile(collaborationUri(collabName));
                                await vscode.workspace.applyEdit(edit);
                                continue;
                            }
                        }
                        await vscode.workspace.fs.writeFile(this.projectUri(projectName), content);
                        if (projectName.endsWith(".collabconfig")) {
                            this.onUpdateConfig();
                        }
                    }
                }
                else {
                    log("Delete project file/directory " + projectName);
                    await vscode.workspace.fs.delete(this.projectUri(projectName), { recursive: true });
                    this.binaryFiles.delete(projectName);
                }
            }
            else {
                log("Not modified " + projectName);
            }

        } while (state.continue);

        state.collaborationModifying = false;
        this.filesContent.delete(projectName);
        if (state.content) {
            this.filesContent.set(projectName, new FileContent(state.content, true));
        }
        log("End collaboration modified " + projectName);
    }


    /**
     * @brief Handle a file modification (create/modify/delete) in the project folder
     * @param create Wether or not the file was created
     * @param uri Uri of the file
    **/
    private async projectFileModified(create: boolean, uri: vscode.Uri) : Promise<void> {
        // Get file state
        const projectName = this.projectName(uri);
        let collabName = this.toCollabName(projectName);
        let state = this.files.get(projectName);
        if (!state) {
            state = new FileState();
            this.files.set(projectName, state);
        }
        log("Project modified " + projectName);

        // Check if already modifying
        if (state.collaborationModifying) {
            log("Collaboration modifying " + projectName);
            return;
        }
        if (state.projectModifying) {
            log("Project already modifying " + projectName);
            state.continue = true;
            return;
        }
        state.projectModifying = true;

        // Modify collaboration file while project file is modified
        let saveEdit: vscode.WorkspaceEdit | null = null;
        do {
            state.continue = false;

            // Get content, file type and wether or not the file was deleted
            let content: Uint8Array | null | undefined;
            let directory: boolean;
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.File) {
                    log("File " + projectName);
                    content = await vscode.workspace.fs.readFile(uri);
                    log("Content " + content.length + " " + projectName);
                    directory = false;
                }
                else if (stat.type === vscode.FileType.Directory) {
                    log("Directory " + projectName);
                    content = undefined;
                    directory = true;
                }
                else {
                    throw new Error("Synchronization failed : unsupported file type : " + stat.type);
                }
            }
            catch { // File was deleted
                log("Deleted " + projectName);
                content = null;
                directory = false;
            }

            // Modify collaboration file if content was modified
            if (this.wasModified(state.content, content)) {
                if (content) {
                    if (directory) {
                        log("Create collaboration directory " + projectName);
                        state.content = content;
                        await vscode.workspace.fs.createDirectory(collaborationUri(collabName));
                    }
                    else {
                        if (!collabName.endsWith(".collab64") && isBinary(content)) { // Binary file -> add to binary files and rename
                            this.binaryFiles.add(projectName);
                            log("Delete collaboration file/directory " + projectName);
                            const edit = new vscode.WorkspaceEdit();
                            edit.deleteFile(collaborationUri(collabName), { recursive: true });
                            await vscode.workspace.applyEdit(edit);
                            collabName += ".collab64";
                            create = true;
                        }
                        if (create) {
                            log("Create collaboration file " + projectName);
                            create = false;
                            state.content = new Uint8Array();
                            state.continue = true;
                            const edit = new vscode.WorkspaceEdit();
                            edit.createFile(collaborationUri(collabName));
                            await vscode.workspace.applyEdit(edit);
                        }
                        else {
                            log("Modify collaboration file " + projectName);
                            state.content = content;
                            const str = collabName.endsWith(".collab64") ? toBase64(content) : new TextDecoder().decode(content);
                            if (!saveEdit) {
                                saveEdit = new vscode.WorkspaceEdit();
                            }
                            saveEdit.replace(collaborationUri(collabName), new vscode.Range(0, 0, Number.MAX_VALUE, 0), str);
                        }
                    }
                }
                else {
                    log("Delete collaboration file/directory " + projectName);
                    state.content = content;
                    const edit = new vscode.WorkspaceEdit();
                    edit.deleteFile(collaborationUri(collabName), { recursive: true });
                    await vscode.workspace.applyEdit(edit);
                    this.binaryFiles.delete(projectName);
                }
            }
            else {
                log("Not modified " + projectName);
            }

        } while (state.continue);
        if (saveEdit) {
            await this.applyEditAndSave(saveEdit, state);
            if (projectName.endsWith(".collabconfig")) {
                this.onUpdateConfig();
            }
        }

        state.projectModifying = false;
        this.filesContent.delete(projectName);
        if (state.content) {
            this.filesContent.set(projectName, new FileContent(state.content, true));
        }
        log("End project modified " + projectName);
    }


    /**
     * @brief Apply an edit to a file and save the file
     * @param edit The edit
     * @param state State of the file
    **/
    private async applyEditAndSave(edit: vscode.WorkspaceEdit, state: FileState) : Promise<void> {
        state.autoSave = true;
        const editPromise = vscode.workspace.applyEdit(edit);
        const savePromise = new Promise<void>(resolve => state.saveResolve = resolve);
        await editPromise;
        state.autoSave = false;
        await savePromise;
    }


    /**
     * @brief Stop synchronization between the collaboration folder and the project folder
    **/
    public stopSync() : void {
        for (const disposable of this.syncDisposables) {
            disposable.dispose();
        }
        this.synchronizing = false;
        this.syncDisposables = [];
    }


    /**
     * @brief Copy all files from the project folder to a given folder
     * @param folder The folder to copy files to
    **/
    public async copyFiles(folder: vscode.Uri) {
        for (const file of await recurListFolder(this.projectFolder)) {
            await vscode.workspace.fs.copy(this.projectUri(file), fileUri(file, folder));
        }
    }


    /**
     * @brief Copy given files to the project folder
     * @param files URIs of the files to add
     * @param name Name of the folder to add the files to
    **/
    public async addFiles(files: vscode.Uri[], name: string) : Promise<void> {
        for (const file of files) {
            await vscode.workspace.fs.copy(file, this.projectUri(name + "/" + file.path.substring(file.path.lastIndexOf("/") + 1)));
        }
    }


    /**
     * @brief Open a file in the project folder
     * @param name The name of the corresponding file in the collaboration folder
    **/
    public async openFile(name: string) : Promise<void> {
        const uri = this.projectUri(this.toProjectName(name));
        await vscode.commands.executeCommand("vscode.open", uri);
    }


    /**
     * @brief Check if the content of a file was modified
     * @param previousContent Previous content of the file
     * @param newContent Possibly new content of the file
    **/
    private wasModified(previousContent: Uint8Array | null | undefined, newContent: Uint8Array | null | undefined) : boolean {
        if (previousContent === newContent) {
            return false;
        }
        if (!previousContent || !newContent || previousContent.length !== newContent.length) {
            return true;
        }
        for (let i = 0; i < newContent.length; i++) {
            if (newContent[i] !== previousContent[i]) {
                return true;
            }
        }
        return false;
    }


    /**
     * @brief Get the URI of a file in the storage folder
     * @param fileName Name of the file
    **/
    private storageUri(fileName: string) : vscode.Uri {
        return fileUri(fileName, this.storageFolder);
    }

    /**
     * @brief Get the URI of a file in the project folder
     * @param fileName Name of the file in the project folder
    **/
    private projectUri(name: string) : vscode.Uri {
        return fileUri(name, this.projectFolder);
    }

    /**
     * @brief Get the name of a file in the project folder
     * @param uri URI of the file in the project folder
    **/
    private projectName(uri: vscode.Uri) : string {
        return uri.path.substring(this.projectFolder.path.length);
    }

    /**
     * @brief Get the name of a file in the project folder from its name in the collaboration folder
     * @param name Name of the file in the collaboration folder
     * @returns Name of the file in the project folder
    **/
    private toProjectName(name: string) {
        if (name.endsWith(".collab64")) {
            return name.substring(0, name.length - 9);
        }
        return name;
    }

    /**
     * @brief Get the name of a file in the collaboration folder from its name in the project folder
     * @param name Name of the file in the project folder
     * @returns Name of the file in the collaboration folder
    **/
    private toCollabName(name: string) {
        if (this.binaryFiles.has(name)) {
            return name + ".collab64";
        }
        return name;
    }

}



export class FilesConfig {
    public staticRules: string[] = [];
    public ignoreRules: string[] = [];
    public backupFrequency: number = 5;
    public maximumBackups: number = 5;
}



class StorageProject {
    public constructor(
        public version: number, 
        public dynamicID: string, 
        public staticID: string
    ) {}
}



class FileState {
    public content: Uint8Array | null | undefined = undefined; // null: deleted, undefined: directory or not yet assigned
    public projectModifying: boolean = false;
    public collaborationModifying: boolean = false;
    public continue: boolean = false;
    public autoSave: boolean = false;
    public saveResolve: ((value: void | PromiseLike<void>) => void) | null = null;
}



class FileContent {
    public constructor(
        public content: Uint8Array,
        public modified: boolean
    ) {}
}