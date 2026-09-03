import * as vscode from "vscode";
import { Project } from "./Project";
import { showErrorWrap } from "./util";
import { ProjectProfileProvider } from "./ProjectProfile";
import { BinaryFileEditorProvider } from "./BinaryFileEditor";
import { IgnoredDecorationProvider } from "./IgnoredDecoration";


export let context : vscode.ExtensionContext;
export let currentFolder: vscode.Uri;
export let collaborationFolder: vscode.Uri;
export let projectFolder: vscode.Uri;
export let output: vscode.LogOutputChannel;


// Function called when the extension is activated
export async function activate(_context: vscode.ExtensionContext) {
	context = _context;
    if (vscode.workspace.workspaceFolders && context.storageUri) {
        currentFolder = vscode.workspace.workspaceFolders[0].uri;
        collaborationFolder = vscode.Uri.joinPath(currentFolder, "Project");
        projectFolder = vscode.Uri.joinPath(context.storageUri, "Project");
    }
    output = vscode.window.createOutputChannel("Cloud Collaboration", { log: true });

    // Activate classes
    await Project.activate();

	// Register commands
    const joinProject = vscode.commands.registerCommand("cloud-collaboration.joinProject", showErrorWrap(Project.joinProject));
    context.subscriptions.push(joinProject);
    const removeProject = vscode.commands.registerCommand("cloud-collaboration.removeProject", showErrorWrap(Project.removeProject));
    context.subscriptions.push(removeProject);
    const connect = vscode.commands.registerCommand("cloud-collaboration.connect", showErrorWrap(Project.connect));
    context.subscriptions.push(connect);
    const disconnect = vscode.commands.registerCommand("cloud-collaboration.disconnect", showErrorWrap(Project.disconnect));
    context.subscriptions.push(disconnect);
    const newTerminal = vscode.commands.registerCommand("cloud-collaboration.newTerminal", showErrorWrap(async () => 
        vscode.commands.executeCommand("workbench.action.terminal.newWithCwd", { cwd: projectFolder.fsPath })
    ));
    context.subscriptions.push(newTerminal);
    const uploadFiles = vscode.commands.registerCommand("cloud-collaboration.uploadFiles", showErrorWrap((uri: vscode.Uri) => Project.instance?.uploadFiles(uri)));
    context.subscriptions.push(uploadFiles);

    // Register editors
    const binaryFileEditor = vscode.window.registerCustomEditorProvider("cloud-collaboration.binaryFileEditor", new BinaryFileEditorProvider());
    context.subscriptions.push(binaryFileEditor);

    // Register file decorations
    const ignoredDecorationProvider = vscode.window.registerFileDecorationProvider(new IgnoredDecorationProvider());
    context.subscriptions.push(ignoredDecorationProvider);

    // Register terminal profiles
    const terminal = vscode.window.registerTerminalProfileProvider("cloud-collaboration.terminal", new ProjectProfileProvider());
    context.subscriptions.push(terminal);
}


// Function called when the extension is deactivated
export async function deactivate() : Promise<void> {
    // Deactivate classes
    await Project.deactivate();
}