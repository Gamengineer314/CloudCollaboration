import * as vscode from "vscode";
import { Project } from "./Project";
import { isBinary, toBase64, fromBase64 } from "./BinaryFiles";
import {
    collaborationUri, collaborationName, inCollaboration, collaborationRecurListFolder,
    projectName, projectUri, projectRecurListFolder, toProjectName,
    showErrorWrap, log
} from "./util";
import { collaborationFolder, projectFolder } from "./extension";


/**
 * @brief Synchronize files between the collaboration and the project folders
**/
export class FileSynchronizer {

    private files : Map<string, FileState> = new Map<string, FileState>();
    private filesContent : Map<string, FileContent> = new Map<string, FileContent>();
    private binaryFiles : Set<string> = new Set<string>(); // Name of all binary files
    private syncDisposables : vscode.Disposable[] = [];


    /**
     * @brief Load files from the project folder to the collaboration folder
    **/
    public async loadCollaboration() : Promise<void> {
        log("Load collaboration");
        await vscode.workspace.fs.delete(collaborationFolder, { recursive: true });
        await vscode.workspace.fs.createDirectory(collaborationFolder);
        for (const name of await projectRecurListFolder([vscode.FileType.File, vscode.FileType.Directory])) {
            this.loadFile(name, projectUri(name), collaborationUri(this.toCollaborationName(name)));
        }
    }

    /**
     * @brief Load files from the collaboration folder to the project folder
    **/
    public async loadProject() : Promise<void> {
        log("Load project");
        await vscode.workspace.fs.delete(projectFolder, { recursive: true });
        await vscode.workspace.fs.createDirectory(projectFolder);
        for (const collabName of await collaborationRecurListFolder([vscode.FileType.File, vscode.FileType.Directory])) {
            const name = toProjectName(collabName);
            this.loadFile(name, collaborationUri(collabName), projectUri(name));
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
     * @brief Start synchronization between the collaboration folder and the project folder
     * @param host Wether or not the collaboration user is the host of the Live Share session
    **/
    public async startSync(host: boolean) : Promise<void> {
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
                    if (inCollaboration(uri)) {
                        collaborationCreated(uri);
                    }
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidDeleteFiles(event => {
                for (const uri of event.files) {
                    if (inCollaboration(uri)) {
                        collaborationModified(uri);
                    }
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidSaveTextDocument(document => {
                if (inCollaboration(document.uri)) {
                    collaborationModified(document.uri);
                }
            }));
            this.syncDisposables.push(vscode.workspace.onDidRenameFiles(event => {
                for (const uri of event.files) {
                    if (inCollaboration(uri.oldUri)) {
                        collaborationModified(uri.oldUri);
                    }
                    if (inCollaboration(uri.newUri)) {
                        collaborationCreated(uri.newUri);
                    }
                }
            }));
        }

        // Listen to file modification events (project folder -> collaboration folder)
        const projectModified = showErrorWrap(this.projectFileModified.bind(this, false));
        const projectCreated = showErrorWrap(this.projectFileModified.bind(this, true));
        const projectWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(projectFolder, "**"));
        this.syncDisposables.push(projectWatcher.onDidCreate(projectCreated));
        this.syncDisposables.push(projectWatcher.onDidDelete(projectModified));
        this.syncDisposables.push(projectWatcher.onDidChange(projectModified));
        this.syncDisposables.push(projectWatcher);

        // Auto-save modifications made by the extension in the collaboration folder
        this.syncDisposables.push(vscode.workspace.onDidChangeTextDocument(showErrorWrap((event: vscode.TextDocumentChangeEvent) => {
            if (event.contentChanges.length > 0) {
                const name = toProjectName(collaborationName(event.document.uri));
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
     * @brief Handle a file modification (create/modify/delete) in the collaboration folder
     * @param create Wether or not the file was created
     * @param uri Uri of the file
    **/
    private async collaborationFileModified(create: boolean, uri: vscode.Uri) : Promise<void> {
        // Get file state
        const collabName = collaborationName(uri);
        const name = toProjectName(collabName);
        let state = this.files.get(name);
        if (!state) {
            state = new FileState();
            this.files.set(name, state);
        }
        log("Collaboration modified " + name);

        // Check if already modifying
        if (state.projectModifying) {
            log("Project modifying " + name);
            return;
        }
        if (state.collaborationModifying) {
            log("Collaboration already modifying " + name);
            state.continue = true;
            return;
        }
        state.collaborationModifying = true;

        // Modify project file while collaboration file is modified
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
                            vscode.window.showErrorMessage("Binary files must be added with the 'Upload Files' command", "Upload files")
                            .then(showErrorWrap(async (item: string | undefined) => {
                                if (item) {
                                    await Project.instance?.uploadFiles(collaborationFolder);
                                }
                            }));
                            state.content = undefined;
                            const edit = new vscode.WorkspaceEdit();
                            edit.deleteFile(collaborationUri(collabName));
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

        state.collaborationModifying = false;
        this.filesContent.delete(name);
        if (state.content !== undefined) {
            this.filesContent.set(name, new FileContent(state.content, true));
        }
        log("End collaboration modified " + name);
    }


    /**
     * @brief Handle a file modification (create/modify/delete) in the project folder
     * @param create Wether or not the file was created
     * @param uri Uri of the file
    **/
    private async projectFileModified(create: boolean, uri: vscode.Uri) : Promise<void> {
        // Get file state
        const name = projectName(uri);
        let collabName = this.toCollaborationName(name);
        let state = this.files.get(name);
        if (!state) {
            state = new FileState();
            this.files.set(name, state);
        }
        log("Project modified " + name);

        // Check if already modifying
        if (state.collaborationModifying) {
            log("collaboration modifying " + name);
            return;
        }
        if (state.projectModifying) {
            log("Project already modifying " + name);
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

            // Modify collaboration file if content was modified
            if (this.wasModified(state.content, content)) {
                if (content === undefined) {
                    log("Delete collaboration file/directory " + name);
                    state.content = content;
                    const edit = new vscode.WorkspaceEdit();
                    edit.deleteFile(collaborationUri(collabName), { recursive: true });
                    await vscode.workspace.applyEdit(edit);
                    this.binaryFiles.delete(name);
                }
                else if (content === null) {
                    log("Create collaboration directory " + name);
                    state.content = content;
                    await vscode.workspace.fs.createDirectory(collaborationUri(collabName));
                }
                else {
                    if (!collabName.endsWith(".collab64") && isBinary(content)) { // Binary file -> add to binary files and rename
                        this.binaryFiles.add(name);
                        log("Delete collaboration file/directory " + name);
                        const edit = new vscode.WorkspaceEdit();
                        edit.deleteFile(collaborationUri(collabName), { recursive: true });
                        await vscode.workspace.applyEdit(edit);
                        collabName += ".collab64";
                        create = true;
                    }
                    if (create) {
                        log("Create collaboration file " + name);
                        create = false;
                        state.content = new Uint8Array();
                        state.continue = true;
                        const edit = new vscode.WorkspaceEdit();
                        edit.createFile(collaborationUri(collabName));
                        await vscode.workspace.applyEdit(edit);
                    }
                    else {
                        log("Modify collaboration file " + name);
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
     * @brief Stop synchronization between the collaboration folder and the project folder
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
     * @brief Get the name of a file in the collaboration folder from its name in the project folder
     * @param name Name of the file in the project folder
     * @returns Name of the file in the collaboration folder
    **/
    private toCollaborationName(name: string) {
        if (this.binaryFiles.has(name)) {
            return name + ".collab64";
        }
        return name;
    }

}



class FileState {
    public content: Uint8Array | null | undefined = undefined; // undefined: deleted file/directory, null: existing directory
    public projectModifying: boolean = false;
    public collaborationModifying: boolean = false;
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