import { CancellationToken, FileDecoration, FileDecorationProvider, ThemeColor, Uri, Event, EventEmitter, Disposable } from "vscode";
import { collaborationUri, inCollaboration, recurListFolder } from "./util";
import { Project } from "./Project";


export class IgnoredDecorationProvider implements FileDecorationProvider {

    private static _instance: IgnoredDecorationProvider | undefined = undefined;
    public static get instance() { return IgnoredDecorationProvider._instance; }    

    constructor() {
        if (IgnoredDecorationProvider.instance) {
            throw new Error("Only one instance of IgnoreDecorationProvider can be created");
        }
        IgnoredDecorationProvider._instance = this;
    }

    private _onDidChangeFileDecorations: EventEmitter<Uri[]> = new EventEmitter<Uri[]>();
    public readonly onDidChangeFileDecorations: Event<Uri[]> = this._onDidChangeFileDecorations.event;


    public provideFileDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
        if (!Project.hasProject) {
            return undefined;
        }

        if (!inCollaboration(uri)) {
            return { color: new ThemeColor("gitDecoration.ignoredResourceForeground") };
        }

        // TODO: check if gitignored

        return undefined;
    }


    // TODO: call this function when a gitignore is modified
    /**
     * @brief Update the decorations of all files in a folder
     * @param name Name of the folder in the collaboration folder
    **/
    public async updateFolder(name: string) {
        const names = await recurListFolder(collaborationUri(name));
        this._onDidChangeFileDecorations.fire(names.map(collaborationUri));
    }
}