import { CancellationToken, FileDecoration, FileDecorationProvider, ThemeColor, Uri, Event, EventEmitter, Disposable } from "vscode";
import { collaborationName, currentRecurListFolder, currentUri } from "./util";
import { match } from "./FileRules";
import { Project } from "./Project";


let staticRules: Array<string> = new Array<string>();
let ignoreRules: Array<string> = new Array<string>();

export class IgnoreStaticDecorationProvider implements FileDecorationProvider {

    private static _instance: IgnoreStaticDecorationProvider | undefined = undefined;
    public static get instance() { return IgnoreStaticDecorationProvider._instance; }

    constructor() {
        if (IgnoreStaticDecorationProvider.instance) {
            throw new Error("Only one instance of IgnoreStaticDecorationProvider can be created");
        }
        IgnoreStaticDecorationProvider._instance = this;
    }

    private _onDidChangeFileDecorations: EventEmitter<Uri[]> = new EventEmitter<Uri[]>();
    public readonly onDidChangeFileDecorations: Event<Uri[]> = this._onDidChangeFileDecorations.event;

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


    /**
     * @brief Update the decorations of all files
    **/
    public async update() {
        // Get the static and ignore rules
        if (!Project.instance) {
            throw new Error("File decoration failed : not connected");
        }
        staticRules = Project.instance.config.filesConfig.staticRules;
        ignoreRules = Project.instance.config.filesConfig.ignoreRules;


        // Update the decorations
        // Get all names
        const names = await currentRecurListFolder();
        
        // Convert to URIs using collaborationUri()
        const uris = names.map(name => currentUri(name));
        this._onDidChangeFileDecorations.fire(uris);
    }
}