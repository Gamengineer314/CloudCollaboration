import * as vscode from "vscode";
import { currentName, inCurrent, logError } from "./util";
import { Project } from "./Project";


export class BinaryFileEditorProvider implements vscode.CustomTextEditorProvider {

    // Called when our custom editor is opened.
    public async resolveCustomTextEditor(document: vscode.TextDocument) : Promise<void> {
        // Checks
        if (!Project.instance) {
            logError("Binary file failed to open : not connected");
            vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            return;
        }
        if (!inCurrent(document.uri)) {
            logError("Binary file failed to open : not in the Project folder");
            vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            return;
        }

        // Close this editor and open the actual file
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        await Project.instance.openProjectFile(currentName(document.uri));
    }
}