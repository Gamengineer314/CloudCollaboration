import * as vscode from "vscode";
import { Project } from "./Project";
import { isBinary, toBase64, fromBase64 } from "./BinaryFiles";
import { currentUri, currentName, currentRecurListFolder, projectName, projectUri, showErrorWrap, log, projectListFolder, inCurrent, projectRecurListFolder, currentListFolder, deleteFiles } from "./util";
import { currentFolder, projectFolder } from "./extension";


/**
 * @brief Synchronize files between the current and the project folders
**/
export class FileSynchronizer {

    private files : Map<string, FileState> = new Map<string, FileState>();
    private filesContent : Map<string, FileContent> = new Map<string, FileContent>();
    private binaryFiles : Set<string> = new Set<string>(); // Name of all binary files
    private syncDisposables : vscode.Disposable[] = [];


    /**
     * @brief Load files from the project folder to the current folder
    **/
    public async loadCurrent() : Promise<void> {
        log("Load current");
        this.clearCurrent();
        for (const name of await projectRecurListFolder([vscode.FileType.File, vscode.FileType.Directory])) {
            this.loadFile(name, projectUri(name), currentUri(this.toCurrentName(name)));
        }
    }

    /**
     * @brief Load files from the current folder to the project folder
    **/
    public async loadProject() : Promise<void> {
        log("Load project");
        this.clearProject();
        for (const collabName of await currentRecurListFolder([vscode.FileType.File, vscode.FileType.Directory])) {
            const name = this.toProjectName(collabName);
            this.loadFile(name, currentUri(collabName), projectUri(name));
        }
    }

    private async loadFile(name: string, srcUri: vscode.Uri, dstUri: vscode.Uri) {
        const type = (await vscode.workspace.fs.stat(srcUri)).type;
        let content = type === vscode.FileType.Directory ? null : await vscode.workspace.fs.readFile(srcUri);
        const state = new FileState();
        state.content = content;
        this.files.set(name, state);
        this.filesContent.set(name, new FileContent(content, false));
        if (content === null) {
            await vscode.workspace.fs.createDirectory(dstUri);
        }
        else {
            if (isBinary(content)) {
                this.binaryFiles.add(name);
                content = new TextEncoder().encode(toBase64(content));
            }
            await vscode.workspace.fs.writeFile(dstUri, content);
        }
    }


    /**
     * @brief Clear all files in the current folder
    **/
    public async clearCurrent() : Promise<void> {
        log("Clear current");
        await deleteFiles(await currentListFolder());
    }

    /**
     * @brief Clear all files in the project folder
    **/
    public async clearProject() : Promise<void> {
        log("Clear project");
        await deleteFiles(await projectListFolder());
    }


    /**
     * @brief Start synchronization between the current folder and the project folder
     * @param host Wether or not the current user is the host of the Live Share session
    **/
    public async startSync(host: boolean) : Promise<void> {
        // Listen to file modification events (current folder -> project folder)
        const currentModified = showErrorWrap(this.currentFileModified.bind(this, false));
        const currentCreated = showErrorWrap(this.currentFileModified.bind(this, true));
        const currentWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(currentFolder, "**"));
        this.syncDisposables.push(currentWatcher.onDidCreate(currentCreated));
        this.syncDisposables.push(currentWatcher.onDidDelete(currentModified));
        this.syncDisposables.push(currentWatcher.onDidChange(currentModified));
        this.syncDisposables.push(currentWatcher);
        if (!host) { // Double listening because some events are not triggered in some situations in Live Share
            this.syncDisposables.push(vscode.workspace.onDidCreateFiles(event => {
                for (const uri of event.files) {
                    if (inCurrent(uri)) {
                        currentCreated(uri);
                    }
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidDeleteFiles(event => {
                for (const uri of event.files) {
                    if (inCurrent(uri)) {
                        currentModified(uri);
                    }
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidSaveTextDocument(document => {
                if (inCurrent(document.uri)) {
                    currentModified(document.uri);
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidRenameFiles(event => {
                for (const uri of event.files) {
                    if (inCurrent(uri.oldUri)) {
                        currentModified(uri.oldUri);
                    }
                    if (inCurrent(uri.newUri)) {
                        currentCreated(uri.newUri);
                    }
                }
            }));
        }

        // Listen to file modification events (project folder -> current folder)
        const projectModified = showErrorWrap(this.projectFileModified.bind(this, false));
        const projectCreated = showErrorWrap(this.projectFileModified.bind(this, true));
        const projectWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(projectFolder, "**"));
        this.syncDisposables.push(projectWatcher.onDidCreate(projectCreated));
        this.syncDisposables.push(projectWatcher.onDidDelete(projectModified));
        this.syncDisposables.push(projectWatcher.onDidChange(projectModified));
        this.syncDisposables.push(projectWatcher);

        // Auto-save modifications made by the extension in the current folder
        this.syncDisposables.push(vscode.workspace.onDidChangeTextDocument(showErrorWrap((event: vscode.TextDocumentChangeEvent) => {
            if (event.contentChanges.length > 0) {
                const name = this.toProjectName(currentName(event.document.uri));
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
    }


    /**
     * @brief Handle a file modification (create/modify/delete) in the current folder
     * @param create Wether or not the file was created
     * @param uri Uri of the file
    **/
    private async currentFileModified(create: boolean, uri: vscode.Uri) : Promise<void> {
        // Get file state
        const collabName = currentName(uri);
        const name = this.toProjectName(collabName);
        let state = this.files.get(name);
        if (!state) {
            state = new FileState();
            this.files.set(name, state);
        }
        log("Current modified " + name);

        // Check if already modifying
        if (state.projectModifying) {
            log("Project modifying " + name);
            return;
        }
        if (state.currentModifying) {
            log("Current already modifying " + name);
            state.continue = true;
            return;
        }
        state.currentModifying = true;

        // Modify project file while current file is modified
        do {
            state.continue = false;

            // Get content, file type and wether or not the file was deleted
            let content: Uint8Array | null | undefined;
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.File) {
                    log("File " + name);
                    content = await vscode.workspace.fs.readFile(uri);
                    if (collabName.endsWith(".collab64")) { // Binary file -> decode base64
                        content = fromBase64(new TextDecoder().decode(content));
                    }
                    log("Content " + content.length + " " + name);
                }
                else if (stat.type === vscode.FileType.Directory) {
                    log("Directory " + name);
                    content = null;
                }
                else {
                    throw new Error("Synchronization failed : unsupported file type : " + stat.type);
                }
            }
            catch { // File was deleted
                log("Deleted " + name);
                content = undefined;
            }

            // Modify project file if content was modified
            if (this.wasModified(state.content, content)) {
                state.content = content;
                if (content === undefined) {
                    log("Delete project file/directory " + name);
                    await vscode.workspace.fs.delete(projectUri(name), { recursive: true });
                    this.binaryFiles.delete(name);
                }
                else if (content === null) {
                    log("Create project directory " + name);
                    await vscode.workspace.fs.createDirectory(projectUri(name));
                }
                else {
                    log((create ? "Create" : "Modify") + " project file " + name);
                    if (create) {
                        create = false;
                        if (collabName.endsWith(".collab64")) { // Binary file -> add to binary files
                            this.binaryFiles.add(name);
                        }
                        else if (isBinary(content)) { // Shouldn't be binary
                            log("Shouldn't be binary " + name);
                            vscode.window.showErrorMessage("Binary files must be added with the 'Upload files' command", "Upload files")
                            .then(showErrorWrap(async (item: string | undefined) => {
                                if (item) {
                                    await Project.instance?.uploadFiles(currentFolder);
                                }
                            }));
                            state.content = undefined;
                            const edit = new vscode.WorkspaceEdit();
                            edit.deleteFile(currentUri(collabName));
                            await vscode.workspace.applyEdit(edit);
                            continue;
                        }
                    }
                    await vscode.workspace.fs.writeFile(projectUri(name), content);
                }
            }
            else {
                log("Not modified " + name);
            }

        } while (state.continue);

        state.currentModifying = false;
        this.filesContent.delete(name);
        if (state.content !== undefined) {
            this.filesContent.set(name, new FileContent(state.content, true));
        }
        log("End current modified " + name);
    }


    /**
     * @brief Handle a file modification (create/modify/delete) in the project folder
     * @param create Wether or not the file was created
     * @param uri Uri of the file
    **/
    private async projectFileModified(create: boolean, uri: vscode.Uri) : Promise<void> {
        // Get file state
        const name = projectName(uri);
        let collabName = this.toCurrentName(name);
        let state = this.files.get(name);
        if (!state) {
            state = new FileState();
            this.files.set(name, state);
        }
        log("Project modified " + name);

        // Check if already modifying
        if (state.currentModifying) {
            log("current modifying " + name);
            return;
        }
        if (state.projectModifying) {
            log("Project already modifying " + name);
            state.continue = true;
            return;
        }
        state.projectModifying = true;

        // Modify current file while project file is modified
        let saveEdit: vscode.WorkspaceEdit | null = null;
        do {
            state.continue = false;

            // Get content, file type and wether or not the file was deleted
            let content: Uint8Array | null | undefined;
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.File) {
                    log("File " + name);
                    content = await vscode.workspace.fs.readFile(uri);
                    log("Content " + content.length + " " + name);
                }
                else if (stat.type === vscode.FileType.Directory) {
                    log("Directory " + name);
                    content = null;
                }
                else {
                    throw new Error("Synchronization failed : unsupported file type : " + stat.type);
                }
            }
            catch { // File was deleted
                log("Deleted " + name);
                content = undefined;
            }

            // Modify current file if content was modified
            if (this.wasModified(state.content, content)) {
                if (content === undefined) {
                    log("Delete current file/directory " + name);
                    state.content = content;
                    const edit = new vscode.WorkspaceEdit();
                    edit.deleteFile(currentUri(collabName), { recursive: true });
                    await vscode.workspace.applyEdit(edit);
                    this.binaryFiles.delete(name);
                }
                else if (content === null) {
                    log("Create current directory " + name);
                    state.content = content;
                    await vscode.workspace.fs.createDirectory(currentUri(collabName));
                }
                else {
                    if (!collabName.endsWith(".collab64") && isBinary(content)) { // Binary file -> add to binary files and rename
                        this.binaryFiles.add(name);
                        log("Delete current file/directory " + name);
                        const edit = new vscode.WorkspaceEdit();
                        edit.deleteFile(currentUri(collabName), { recursive: true });
                        await vscode.workspace.applyEdit(edit);
                        collabName += ".collab64";
                        create = true;
                    }
                    if (create) {
                        log("Create current file " + name);
                        create = false;
                        state.content = new Uint8Array();
                        state.continue = true;
                        const edit = new vscode.WorkspaceEdit();
                        edit.createFile(currentUri(collabName));
                        await vscode.workspace.applyEdit(edit);
                    }
                    else {
                        log("Modify current file " + name);
                        state.content = content;
                        const str = collabName.endsWith(".collab64") ? toBase64(content) : new TextDecoder().decode(content);
                        if (!saveEdit) {
                            saveEdit = new vscode.WorkspaceEdit();
                        }
                        saveEdit.replace(currentUri(collabName), new vscode.Range(0, 0, Number.MAX_VALUE, 0), str);
                    }
                }
            }
            else {
                log("Not modified " + name);
            }

        } while (state.continue);
        if (saveEdit) {
            await this.applyEditAndSave(saveEdit, state);
        }

        state.projectModifying = false;
        this.filesContent.delete(name);
        if (state.content !== undefined) {
            this.filesContent.set(name, new FileContent(state.content, true));
        }
        log("End project modified " + name);
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
     * @brief Stop synchronization between the current folder and the project folder
    **/
    public stopSync() : void {
        for (const disposable of this.syncDisposables) {
            disposable.dispose();
        }
        this.syncDisposables = [];
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
     * @brief Get the name of a file in the project folder from its name in the current folder
     * @param name Name of the file in the current folder
     * @returns Name of the file in the project folder
    **/
    public toProjectName(name: string) {
        if (name.endsWith(".collab64")) {
            return name.substring(0, name.length - 9);
        }
        return name;
    }

    /**
     * @brief Get the name of a file in the current folder from its name in the project folder
     * @param name Name of the file in the project folder
     * @returns Name of the file in the current folder
    **/
    public toCurrentName(name: string) {
        if (this.binaryFiles.has(name)) {
            return name + ".collab64";
        }
        return name;
    }

}



class FileState {
    public content: Uint8Array | null | undefined = undefined; // undefined: deleted file/directory, null: existing directory
    public projectModifying: boolean = false;
    public currentModifying: boolean = false;
    public continue: boolean = false;
    public autoSave: boolean = false;
    public saveResolve: ((value: void | PromiseLike<void>) => void) | null = null;
}



class FileContent {
    public constructor(
        public content: Uint8Array | null,
        public modified: boolean
    ) {}
}