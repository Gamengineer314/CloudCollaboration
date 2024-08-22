import * as vscode from "vscode";
import { GoogleDrive } from "./GoogleDrive";
import { Project } from "./Project";


export let context : vscode.ExtensionContext;


// Function called when the extension is activated
export async function activate(_context: vscode.ExtensionContext) {
	context = _context;

	// Custom contexts for 'when' clauses
	vscode.commands.executeCommand("setContext", "cloud-collaboration.authenticated", false);

    // Activate classes
    await GoogleDrive.activate();

	// Register commands
	const authenticate = vscode.commands.registerCommand("cloud-collaboration.authenticate", commandCallback(GoogleDrive.authenticate));
	context.subscriptions.push(authenticate);
	const unauthenticate = vscode.commands.registerCommand("cloud-collaboration.unauthenticate", commandCallback(GoogleDrive.unauthenticate));
	context.subscriptions.push(unauthenticate);
    const createProject = vscode.commands.registerCommand("cloud-collaboration.createProject", commandCallback(Project.createProject));
    context.subscriptions.push(createProject);
    const joinSharedProject = vscode.commands.registerCommand("cloud-collaboration.joinSharedProject", commandCallback(Project.joinSharedProject));
    context.subscriptions.push(joinSharedProject);
    const joinPublicProject = vscode.commands.registerCommand("cloud-collaboration.joinPublicProject", commandCallback(Project.joinPublicProject));
    context.subscriptions.push(joinPublicProject);
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
            console.error("Error : " + error);
        }
    };
}