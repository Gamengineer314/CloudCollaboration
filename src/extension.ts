import * as vscode from "vscode";
import { GoogleDrive } from "./GoogleDrive";
import { Project } from "./Project";
import { LiveShare } from "./LiveShare";


export let context : vscode.ExtensionContext;


// Function called when the extension is activated
export async function activate(_context: vscode.ExtensionContext) {
	context = _context;

	// Custom contexts for 'when' clauses
	vscode.commands.executeCommand("setContext", "cloud-collaboration.authenticated", false);
    vscode.commands.executeCommand("setContext", "cloud-collaboration.connected", false);
    vscode.commands.executeCommand("setContext", "cloud-collaboration.liveShareAvailable", false);

    // Activate classes
    await LiveShare.activate();
    await GoogleDrive.activate();
    await Project.activate();

	// Register commands
	const authenticate = vscode.commands.registerCommand("cloud-collaboration.authenticate", commandCallback(GoogleDrive.authenticate));
	context.subscriptions.push(authenticate);
	const unauthenticate = vscode.commands.registerCommand("cloud-collaboration.unauthenticate", commandCallback(GoogleDrive.unauthenticate));
	context.subscriptions.push(unauthenticate);
    const createProject = vscode.commands.registerCommand("cloud-collaboration.createProject", commandCallback(Project.createProject));
    context.subscriptions.push(createProject);
    const joinSharedProject = vscode.commands.registerCommand("cloud-collaboration.joinProject", commandCallback(Project.joinProject));
    context.subscriptions.push(joinSharedProject);
    const connect = vscode.commands.registerCommand("cloud-collaboration.connect", commandCallback(Project.connect));
    context.subscriptions.push(connect);
    const disconnect = vscode.commands.registerCommand("cloud-collaboration.disconnect", commandCallback(Project.disconnect));
    context.subscriptions.push(disconnect);
}


// Function called when the extension is deactivated
export function deactivate() {
    // Deactivate classes
    GoogleDrive.deactivate();
}


/**
 * @brief Wrap a command callback to display errors
 * @param callback Callback to wrap
 * @returns Wrapped callback
**/
function commandCallback(callback: () => any) : () => Promise<void> {
    return async () => {
        try {
            await callback();
        }
        catch (error : any) {
            vscode.window.showErrorMessage(error.message);
            console.error(error);
        }
    };
}