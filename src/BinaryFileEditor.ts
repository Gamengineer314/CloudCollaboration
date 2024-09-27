import * as vscode from "vscode";
import { collaborationName, logError } from "./util";
import { Project } from "./Project";


export class BinaryFileEditorProvider implements vscode.CustomTextEditorProvider {

    // Called when our custom editor is opened.
    public async resolveCustomTextEditor(document: vscode.TextDocument) : Promise<void> {
        // Check if connected
        if (!Project.instance) {
            logError("Binary file failed to open : not connected");
            vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            return;
        }

        // Get the binary file path
        const collaborationFileName = collaborationName(document.uri);
        if (collaborationFileName === "") {
            logError("Binary file failed to open : not in the Project folder");
            vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            return;
        }

        // Close the editor
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

        // Open the binary file
        await Project.instance.openProjectFile(collaborationFileName);
    }
}