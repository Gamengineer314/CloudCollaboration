import { TerminalProfileProvider, CancellationToken, ProviderResult, TerminalProfile } from "vscode";
import { Project } from "./Project";


export class ProjectProfileProvider implements TerminalProfileProvider {
    public provideTerminalProfile(): ProviderResult<TerminalProfile> {
        return new TerminalProfile({
            cwd: Project.instance?.projectPath,
        });
    }
}