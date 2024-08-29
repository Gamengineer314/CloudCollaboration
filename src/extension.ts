import * as vscode from "vscode";
import { GoogleDrive } from "./GoogleDrive";
import { Project } from "./Project";
import { LiveShare } from "./LiveShare";
import { LaunchEditorProvider } from "./LaunchEditor";
import { showErrorWrap } from "./util";


export let context : vscode.ExtensionContext;
export let folder: vscode.Uri;
export let storageFolder: vscode.Uri;


// Function called when the extension is activated
export async function activate(_context: vscode.ExtensionContext) {
	context = _context;
    if (vscode.workspace.workspaceFolders) {
        folder = vscode.workspace.workspaceFolders?.[0].uri;
    }
    if (context.storageUri) {
        storageFolder = context.storageUri;
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
    const userShare = vscode.commands.registerCommand("cloud-collaboration.userShare", showErrorWrap(() => Project.Instance?.userShare()));
    context.subscriptions.push(userShare);
    const userUnshare = vscode.commands.registerCommand("cloud-collaboration.userUnshare", showErrorWrap(() => Project.Instance?.userUnshare()));
    context.subscriptions.push(userUnshare);
    const publicShare = vscode.commands.registerCommand("cloud-collaboration.publicShare", showErrorWrap(() => Project.Instance?.publicShare()));
    context.subscriptions.push(publicShare);
    const publicUnshare = vscode.commands.registerCommand("cloud-collaboration.publicUnshare", showErrorWrap(() => Project.Instance?.publicUnshare()));
    context.subscriptions.push(publicUnshare);

    // Register editors
    const launchEditor = vscode.window.registerCustomEditorProvider("cloud-collaboration.launchEditor", new LaunchEditorProvider());
    context.subscriptions.push(launchEditor);
}


// Function called when the extension is deactivated
export function deactivate() {
    // Deactivate classes
    GoogleDrive.deactivate();
}