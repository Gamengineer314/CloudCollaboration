import { CancellationToken, FileDecoration, FileDecorationProvider, ThemeColor, Uri } from "vscode";
import { inCollaboration } from "./util";
import { Project } from "./Project";


export class IgnoredDecorationProvider implements FileDecorationProvider {
    public provideFileDecoration(uri: Uri, _token: CancellationToken): FileDecoration | undefined {
        return Project.hasProject && !inCollaboration(uri) ? {
            color: new ThemeColor("gitDecoration.ignoredResourceForeground")
        } : undefined;
    }
}