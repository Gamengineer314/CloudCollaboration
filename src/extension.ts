import * as vscode from "vscode";
import { GoogleDrive } from "./GoogleDrive";
import { Project } from "./Project";
import { LiveShare } from "./LiveShare";
import { LaunchEditorProvider } from "./LaunchEditor";
import { ConfigEditorProvider } from "./ConfigEditor";
import { showErrorWrap } from "./util";


export let context : vscode.ExtensionContext;
export let currentFolder: vscode.Uri;


// Function called when the extension is activated
export async function activate(_context: vscode.ExtensionContext) {
	context = _context;
    if (vscode.workspace.workspaceFolders) {
        currentFolder = vscode.workspace.workspaceFolders?.[0].uri;
    }

	// Custom contexts for 'when' clauses
	vscode.commands.executeCommand("setContext", "cloud-collaboration.authenticated", false);
    vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
    vscode.commands.executeCommand("setContext", "cloud-collaboration.liveShareAvailable", false);

    // Activate classes
    await LiveShare.activate();
    await GoogleDrive.activate();
    await Project.activate();

	// Register commands
	const authenticate = vscode.commands.registerCommand("cloud-collaboration.authenticate", showErrorWrap(GoogleDrive.authenticate));
	context.subscriptions.push(authenticate);
	const unauthenticate = vscode.commands.registerCommand("cloud-collaboration.unauthenticate", showErrorWrap(GoogleDrive.unauthenticate));
	context.subscriptions.push(unauthenticate);
    const createProject = vscode.commands.registerCommand("cloud-collaboration.createProject", showErrorWrap(Project.createProject));
    context.subscriptions.push(createProject);
    const joinSharedProject = vscode.commands.registerCommand("cloud-collaboration.joinProject", showErrorWrap(Project.joinProject));
    context.subscriptions.push(joinSharedProject);
    const connect = vscode.commands.registerCommand("cloud-collaboration.connect", showErrorWrap(Project.connect));
    context.subscriptions.push(connect);
    const disconnect = vscode.commands.registerCommand("cloud-collaboration.disconnect", showErrorWrap(Project.disconnect));
    context.subscriptions.push(disconnect);
    const downloadProject = vscode.commands.registerCommand("cloud-collaboration.downloadProject", showErrorWrap(() => Project.Instance?.download()));
    context.subscriptions.push(downloadProject);
    const newTerminal = vscode.commands.registerCommand("cloud-collaboration.newTerminal", showErrorWrap(() => Project.Instance?.newTerminal()));
    context.subscriptions.push(newTerminal);

    // Register editors
    const launchEditor = vscode.window.registerCustomEditorProvider("cloud-collaboration.launchEditor", new LaunchEditorProvider());
    context.subscriptions.push(launchEditor);
    const configEditor = vscode.window.registerCustomEditorProvider("cloud-collaboration.configEditor", new ConfigEditorProvider());
    context.subscriptions.push(configEditor);
}


// Function called when the extension is deactivated
export function deactivate() {
    // Deactivate classes
    GoogleDrive.deactivate();
}