import * as vscode from "vscode";
import { GoogleDrive } from "./GoogleDrive";


export let context : vscode.ExtensionContext;


// Function called when the extension is activated
export async function activate(_context: vscode.ExtensionContext) {
	context = _context;

	// Custom contexts for 'when' clauses
	vscode.commands.executeCommand("setContext", "cloud-collaboration.authenticated", false);

    // Static initializers
    await GoogleDrive.activate();

	// Register commands
	const authenticate = vscode.commands.registerCommand("cloud-collaboration.authenticate", commandCallback(GoogleDrive.authenticate));
	context.subscriptions.push(authenticate);
	const unauthenticate = vscode.commands.registerCommand("cloud-collaboration.unauthenticate", commandCallback(GoogleDrive.unauthenticate));
	context.subscriptions.push(unauthenticate);
}


// Function called when the extension is deactivated
export function deactivate() {

}


/**
 * @brief Wrap a command callback to display errors
 * @param callback Callback to wrap
 * @returns Wrapped callback
**/
function commandCallback(callback: () => void | Promise<void>) : () => Promise<void> {
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