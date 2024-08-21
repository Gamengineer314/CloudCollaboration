import * as vscode from "vscode";
import { Auth, drive_v3 } from "googleapis";
import { Server, createServer } from "http";
import { context } from "./extension";
import { CLIENT_ID, CLIENT_SECRET, API_KEY, PROJECT_NUMBER } from "./credentials";


const PORT = 31415;
const LOCALHOST = "http://localhost:" + PORT;
const SCOPE = "https://www.googleapis.com/auth/drive.file";


export class GoogleDrive {

    private static instance : GoogleDrive | undefined;
    public static get Instance() : GoogleDrive | undefined { return this.instance; };

    private static server : Server | undefined; // Currently running localhost server


    private auth : Auth.OAuth2Client;
    private authDrive : drive_v3.Drive; // For access to user files
    private keyDrive : drive_v3.Drive; // For access to public files

    private constructor(auth: Auth.OAuth2Client) {
        this.auth = auth;
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
            const auth = new Auth.OAuth2Client(CLIENT_ID, CLIENT_SECRET, LOCALHOST);
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
        if (GoogleDrive.instance) { // Already authenticated
            vscode.window.showErrorMessage("Already authenticated");
            return;
        }

        // Open prompt to authenticate and listen to localhost for redirection with code in URL parameters
        const auth = new Auth.OAuth2Client(CLIENT_ID, CLIENT_SECRET, LOCALHOST);
        const randomState = Math.random().toString(36).substring(2);
        GoogleDrive.server?.close();
        GoogleDrive.server = createServer(async (request, response) => {
            // Ignore other calls (ex: icon)
            if (!request.url || request.url[1] !== "?") {
                response.end("");
                return;
            }

            // Redirected with code
            const url = new URL(request.url, LOCALHOST);
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
            GoogleDrive.server?.close();
            GoogleDrive.server = undefined;
        });

        // Prompt URL
        const url = auth.generateAuthUrl({
            scope: SCOPE,
            access_type: "offline",
            state: randomState
        });

        GoogleDrive.server.listen(PORT, async () => {
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


    /**
     * @brief Prompt the user to pick a Google Drive folder containing a project and authorize the extension to access it
    **/
    public async pickProject(callback: (filesID: string, indexID: string) => any ) : Promise<void> {
        let result = "";
        GoogleDrive.server?.close();
        GoogleDrive.server = createServer(async (request, response) => {
            if (!request.url) {
                return;
            }
            
            // Prompt request
            if (request.url === "/") {
                response.end(await this.getPickerHTML());
            }

            // Prompt response
            else if (request.url.startsWith("/response")) {
                if (request.url === "/response/invalid") {
                    vscode.window.showErrorMessage("Project pick failed : invalid project");
                    result = "Project pick failed : invalid project";
                }
                else if (request.url === "/response/canceled") {
                    vscode.window.showErrorMessage("Project pick failed : canceled");
                    result = "Project pick failed : canceled";
                }
                else {
                    const params = new URL(request.url, LOCALHOST).searchParams;
                    const files = params.get("files");
                    const index = params.get("index");
                    if (!files || !index) {
                        return;
                    }
                    callback(files, index);
                    result = "Project pick succeeded. You can close this tab and go back to VSCode.";
                }
                response.end("");
            }

            // Result message
            else if (request.url === "/result") {
                response.end(result);
                GoogleDrive.server?.close();
                GoogleDrive.server = undefined;
            }
        });

        GoogleDrive.server.listen(PORT, async () => {
            // Open prompt
            const opened = await vscode.env.openExternal(vscode.Uri.parse(LOCALHOST));
            if (!opened) {
                vscode.window.showErrorMessage("Project pick failed : prompt not opened");
                GoogleDrive.server?.close();
                GoogleDrive.server = undefined;
            }
        });
    }


    /**
     * @brief HTML to display the Google Picker and send back its response 
    **/
    private async getPickerHTML() : Promise<string> {
        return `<!DOCTYPE html>
<html>
<body>
<script type="text/javascript">
    function createPicker() {
        const view = new google.picker.DocsView()
            .setMimeTypes("application/octet-stream")
            .setQuery("*.collabfiles | *.collabindex");
        const picker = new google.picker.PickerBuilder()
            .addView(view)
            .setTitle("Select a project (both .collabfiles and .collabindex files)")
            .setCallback(pickerCallback)
            .enableFeature(google.picker.Feature.NAV_HIDDEN)
            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
            .setDeveloperKey("${API_KEY}")
            .setAppId("${PROJECT_NUMBER}")
            .setOAuthToken("${(await this.auth.getAccessToken()).token}")
            .build();
        picker.setVisible(true);
    }

    async function pickerCallback(data) {
        if (data.action == google.picker.Action.PICKED) {
            if (data.docs.length === 2 && (
                (data.docs[0].name.endsWith(".collabfiles") && data.docs[1].name.endsWith(".collabindex")) || 
                (data.docs[0].name.endsWith(".collabindex") && data.docs[1].name.endsWith(".collabfiles"))
            )) {
                await fetch("${LOCALHOST}/response?files=" + data.docs[0].id + "&index=" + data.docs[1].id);
            }
            else {
                await fetch("${LOCALHOST}/response/invalid");
            }
            window.location.replace("${LOCALHOST}/result");
        }
        else if (data.action == google.picker.Action.CANCEL) {
            await fetch("${LOCALHOST}/response/canceled");
            window.location.replace("${LOCALHOST}/result");
        }
    }
</script>
<script async defer src="https://apis.google.com/js/api.js" onload="gapi.load('client:picker', createPicker)"></script>
</body>
</html>`;
    }
    
}