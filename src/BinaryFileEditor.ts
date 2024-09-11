import * as vscode from "vscode";
import { CancellationToken, CustomTextEditorProvider, TextDocument, WebviewPanel } from "vscode";
import { collaborationName } from "./util";
import { Project } from "./Project";


export class BinaryFileEditorProvider implements CustomTextEditorProvider {

    // Called when our custom editor is opened.
    public async resolveCustomTextEditor(document: TextDocument, _webviewPanel: WebviewPanel, _token: CancellationToken) : Promise<void> {
        // Open the real binary file then close the editor

        // Get the binary file path
        const fileUri = document.uri.with({ path: document.uri.path.replace(".collab64", '') });
        const collaborationFileName = collaborationName(fileUri);
        if (collaborationFileName === "") {
            // Show error message, close the editor and return
            vscode.window.showErrorMessage("This file is not in the Cloud Collaboration folder");
            vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            return;
        }

        // If the project is not connected, throw an error
        if (!Project.instance) {
            // Show error message, close the editor and return
            vscode.window.showErrorMessage("The project is not connected");
            vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            return;
        }

        // Close the editor (not needed since the file has not been edited and will close automatically)
        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");

        // Open the binary file
        await Project.instance.openProjectFile(collaborationFileName);
    }
}