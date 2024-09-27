import { CancellationToken, FileDecoration, FileDecorationProvider, ThemeColor, Uri, Event, EventEmitter, Disposable } from "vscode";
import { collaborationName, currentRecurListFolder, currentUri } from "./util";
import { match } from "./FileRules";
import { Project } from "./Project";
import { FilesConfig } from "./FileSystem";


export class IgnoreStaticDecorationProvider implements FileDecorationProvider {

    private static _instance: IgnoreStaticDecorationProvider | undefined = undefined;
    public static get instance() { return IgnoreStaticDecorationProvider._instance; }

    private staticRules: string[] = [];
    private ignoreRules: string[] = [];

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
        const fileUri = uri.with({ path: uri.path.replace(".collab64", "") });

        // Get file name
        const name = collaborationName(fileUri);

        // .collablaunch and .collabconfig files
        if (name === ".collablaunch" || name === ".collabconfig") {
            return {
                color: new ThemeColor("cloudCollaboration.special"),
            };
        }

        // If the project is not connected, return undefined
        if (!Project.instance) {
            return undefined;
        }

        // Ignore and static files
        if (name === "" || match(name, this.ignoreRules)) {
            return {
                color: new ThemeColor("cloudCollaboration.ignore"),
            };
        }
        if (match(name, this.staticRules)) {
            return {
                color: new ThemeColor("cloudCollaboration.static"),
            };
        }

        return undefined;
    }


    /**
     * @brief Update the decorations of all files
    **/
    public async update(filesConfig: FilesConfig) {
        // Get the static and ignore rules
        this.staticRules = filesConfig.staticRules;
        this.ignoreRules = filesConfig.ignoreRules;

        // Get all names
        const names = await currentRecurListFolder();
        
        // Convert to URIs using collaborationUri()
        const uris = names.map(name => currentUri(name));
        this._onDidChangeFileDecorations.fire(uris);
    }
    
}