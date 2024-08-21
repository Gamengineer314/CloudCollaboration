import * as vscode from "vscode";
import { Auth, drive_v3 } from "googleapis";
import { Server, createServer } from "http";
import { context } from "./extension";
import { CLIENT_ID, CLIENT_SECRET, API_KEY } from "./credentials";


const REDIRECT_PORT = 31415;
const REDIRECT = "http://localhost:" + REDIRECT_PORT;
const SCOPE = "https://www.googleapis.com/auth/drive.file";


export class GoogleDrive {

    private static instance : GoogleDrive | undefined;
    public static get Instance() : GoogleDrive | undefined { return this.instance; };

    private static server : Server | undefined; // Currently running localhost server


    private authDrive : drive_v3.Drive; // For access to user files
    private keyDrive : drive_v3.Drive; // For access to public files

    private constructor(auth: Auth.OAuth2Client) {
        this.authDrive = new drive_v3.Drive({ auth: auth });
        this.keyDrive = new drive_v3.Drive({ auth: API_KEY });
    }


    /**
     * @brief Activate GoogleDrive class
    **/
    public static async activate() : Promise<void> {
        // Used stored refresh token if available
        const token = await context.secrets.get("googleRefreshToken");
        if (token) {
            const auth = new Auth.OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT);
            auth.setCredentials({ refresh_token: token });
            GoogleDrive.instance = new GoogleDrive(auth);
            vscode.commands.executeCommand("setContext", "cloud-collaboration.authenticated", true);
            return;
        }
    }


    /**
     * @brief Deactivate GoogleDrive class
    **/
    public static deactivate() : void {
        GoogleDrive.server?.close();
    }


    /**
     * @brief Authenticate the user to Google Drive
    **/
    public static authenticate() : void {
        // Already authenticated
        if (GoogleDrive.instance) {
            vscode.window.showErrorMessage("Already authenticated");
            return;
        }

        // Open prompt to authenticate and listen to localhost for redirection with code in URL parameters
        const auth = new Auth.OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT);
        const randomState = Math.random().toString(36).substring(2);
        GoogleDrive.server?.close();
        GoogleDrive.server = createServer(async (request, response) => {
            // Redirected with code
            if (request.url) {
                const url = new URL(request.url, REDIRECT);
                if (url.pathname.length > 1) { // Ignore other calls (ex: icon)
                    return;
                }
                const code = url.searchParams.get("code");
                const state = url.searchParams.get("state");
                if (code && state === randomState) {
                    // Get refresh token from code
                    auth.getToken(code, (error, tokens) => {
                        if (error || !tokens || !tokens.refresh_token) {
                            vscode.window.showErrorMessage("Authentication failed : " + (error ? error.message : "no refresh token"));
                            response.end("Authentication failed : " + (error ? error.message : "no refresh token"));
                        }
                        else {
                            auth.setCredentials(tokens);
                            context.secrets.store("googleRefreshToken", tokens.refresh_token);
                            GoogleDrive.instance = new GoogleDrive(auth);
                            vscode.commands.executeCommand("setContext", "cloud-collaboration.authenticated", true);
                            vscode.window.showInformationMessage("Authenticated to Google Drive");
                            response.end("Authentication succeeded. You can close this tab and go back to VSCode.");
                        }
                    });
                }
                else {
                    vscode.window.showErrorMessage("Authentication failed. Please try again.");
                    response.end("Authentication failed. Please try again.");
                }
            }
            else {
                vscode.window.showErrorMessage("Authentication failed : no URL");
                response.end("Authentication failed : no URL");
            }
            GoogleDrive.server?.close();
            GoogleDrive.server = undefined;
        });

        // Prompt URL
        const url = auth.generateAuthUrl({
            scope: SCOPE,
            access_type: "offline",
            state: randomState
        });

        GoogleDrive.server.listen(REDIRECT_PORT, async () => {
            // Open prompt
            const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
            if (!opened) {
                vscode.window.showErrorMessage("Authentication failed : prompt not opened");
                GoogleDrive.server?.close();
                GoogleDrive.server = undefined;
            }
        });
    }


    /**
     * @brief Unauthenticate the user from Google Drive
    **/
    public static unauthenticate() : void {
        context.secrets.delete("googleRefreshToken");
        GoogleDrive.instance = undefined;
        vscode.commands.executeCommand("setContext", "cloud-collaboration.authenticated", false);
        vscode.window.showInformationMessage("Unauthenticated from Google Drive");
    }
    
}