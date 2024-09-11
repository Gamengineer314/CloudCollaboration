import { CancellationToken, FileDecoration, FileDecorationProvider, ThemeColor, Uri, Event, Disposable } from "vscode";
import { collaborationName, collaborationRecurListFolder, collaborationUri, currentRecurListFolder, currentUri } from "./util";
import { match } from "./FileRules";
import { Project } from "./Project";


let staticRules: Array<string> = new Array<string>();
let ignoreRules: Array<string> = new Array<string>();

export class IgnoreStaticDecorationProvider implements FileDecorationProvider {

    private listeners: Set<(e: Uri[]) => any> = new Set<(e: Uri[]) => any>();

    private static _instance: IgnoreStaticDecorationProvider | undefined = undefined;
    public static get instance() { return IgnoreStaticDecorationProvider._instance; }

    constructor() {
        if (IgnoreStaticDecorationProvider.instance) {
            throw new Error("Only one instance of IgnoreStaticDecorationProvider can be created");
        }
        IgnoreStaticDecorationProvider._instance = this;
    }

    public onDidChangeFileDecorations(listener: (e: Uri[]) => any, thisArgs?: any, disposables?: Disposable[]): Disposable {
        const func = listener.bind(thisArgs);
        this.listeners.add(func);
        const disposable = new Disposable(this.listeners.delete.bind(this.listeners, func));
        if (disposables) {
            disposables.push(disposable);
        }
        return disposable;
    }

    public provideFileDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
        // Remove .collab64 at the end of the file name if it exists
        const fileUri = uri.with({ path: uri.path.replace(".collab64", '') });

        // Get file name
        const fileName = fileUri.path.split('/').pop();
        

        // .collablaunch and .collabconfig files
        if (fileName === '.collablaunch' || fileName === '.collabconfig') {
            return {
                color: new ThemeColor("cloudCollaboration.special"),
            };
        }


        // If the project is not connected, return undefined
        if (!Project.instance) {
            return undefined;
        }


        // Ignore and static files
        // Get the filename compatible with the functions to check if it is a static or ignore file
        const collaborationFileName = collaborationName(fileUri);
        
        // Check if the file is a static or ignore file
        if (match(collaborationFileName, ignoreRules) || collaborationFileName === "") {
            return {
                color: new ThemeColor("cloudCollaboration.ignore"),
            };
        }
        if (match(collaborationFileName, staticRules)) {
            return {
                color: new ThemeColor("cloudCollaboration.static"),
            };
        }

        return undefined;
    }

    public async update() {
        // Get the config from the getConfig function
        if (!Project.instance) {
            throw new Error("File decoration failed : not connected");
        }
        const config = await Project.instance.getConfig();

        // Get the static and ignore rules
        staticRules = config.filesConfig.staticRules;
        ignoreRules = config.filesConfig.ignoreRules;


        // Update the decorations
        // Get all names
        const names = await currentRecurListFolder();
        
        // Convert to URIs using collaborationUri()
        const uris = names.map(name => currentUri(name));
        for (const listener of this.listeners) {
            listener(uris);
        }
    }
}