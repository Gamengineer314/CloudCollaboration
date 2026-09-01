import { TerminalProfileProvider, ProviderResult, TerminalProfile } from "vscode";
import { projectFolder } from "./extension";
import { Project } from "./Project";


export class ProjectProfileProvider implements TerminalProfileProvider {
    public provideTerminalProfile(): ProviderResult<TerminalProfile> {
        return new TerminalProfile({
            cwd: Project.instance ? projectFolder : undefined,
        });
    }
}