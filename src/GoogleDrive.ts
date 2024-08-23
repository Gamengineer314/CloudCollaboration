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
    private drive : drive_v3.Drive;

    private constructor(auth: Auth.OAuth2Client) {
        this.auth = auth;
        this.drive = new drive_v3.Drive({ auth: auth });
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
            vscode.window.showInformationMessage("Please authenticate in the page opened in your browser");
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
    public async pickProject(callback: (filesID: string, indexID: string, urlID: string, name: string) => any ) : Promise<void> {
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
                    result = "Project pick failed : invalid project. Please select the .collabfiles, the .collabindex and the .collaburl files corresponding to the project you want to join.";
                }
                else if (request.url === "/response/canceled") {
                    vscode.window.showErrorMessage("Project pick failed : canceled");
                    result = "Project pick failed : canceled";
                }
                else {
                    const params = new URL(request.url, LOCALHOST).searchParams;
                    const files = params.get("files");
                    const index = params.get("index");
                    const url = params.get("url");
                    const name = params.get("name");
                    if (!files || !index || !url || !name) {
                        return;
                    }
                    callback(files, index, url, name);
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
            vscode.window.showInformationMessage("Please pick a project in the page opened in your browser");
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
            .setMimeTypes("application/octet-stream,text/plain")
            .setQuery("*.collabfiles | *.collabindex | *.collaburl");
        const picker = new google.picker.PickerBuilder()
            .addView(view)
            .setTitle("Select a project (.collabfiles, .collabindex and .collaburl files)")
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
            const fileNames = data.docs.map(doc => doc.name);
            const name = fileNames[0].substring(0, fileNames[0].lastIndexOf("."));
            if (fileNames.length === 3 && fileNames.includes(name + ".collabfiles") && fileNames.includes(name + ".collabindex") && fileNames.includes(name + ".collaburl")) {
                const files = data.docs[fileNames.indexOf(name + ".collabfiles")];
                const index = data.docs[fileNames.indexOf(name + ".collabindex")];
                const url = data.docs[fileNames.indexOf(name + ".collaburl")];
                await fetch("${LOCALHOST}/response?files=" + files.id + "&index=" + index.id + "&url=" + url.id + "&name=" + name);
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


    /**
     * @brief Create a new project in Google Drive
     * @param name Name of the project
     * @returns
     * filesID: ID of the .collabfiles file, 
     * indexID: ID of the .collabindex file, 
     * urlID: ID of the .collaburl file
    **/
    public async createProject(name: string) : Promise<{ filesID: string, indexID: string, urlID: string }> {
        const files = await this.drive.files.create({
            requestBody: {
                name: name + ".collabfiles",
                mimeType: "application/octet-stream"
            },
            media: {
                mimeType: "application/octet-stream",
                body: ""
            },
            fields: "id"
        });
        if (!files.data.id) {
            throw new Error("Failed to create .collabfiles file");
        }

        const index = await this.drive.files.create({
            requestBody: {
                name: name + ".collabindex",
                mimeType: "application/octet-stream"
            },
            media: {
                mimeType: "application/octet-stream",
                body: ""
            },
            fields: "id"
        });
        if (!index.data.id) {
            await this.drive.files.delete({ fileId: files.data.id });
            throw new Error("Failed to create .collabindex file");
        }

        const url = await this.drive.files.create({
            requestBody: {
                name: name + ".collaburl",
                mimeType: "text/plain"
            },
            media: {
                mimeType: "text/plain",
                body: ""
            },
            fields: "id"
        });
        if (!url.data.id) {
            await this.drive.files.delete({ fileId: files.data.id });
            await this.drive.files.delete({ fileId: index.data.id });
            throw new Error("Failed to create .collaburl file");
        }

        return { filesID: files.data.id, indexID: index.data.id, urlID: url.data.id };
    }


    /**
     * @brief Get the URL of the current Live Share session for a project
     * @param urlID ID of the .collaburl file
     * @returns URL of the session if there is one, empty string otherwise
    **/
    public async getLiveShareURL(urlID: string) : Promise<string> {
        const url = await this.drive.files.get({ fileId: urlID, alt: "media" });
        return (url.data as string).substring(1);
    }


    /**
     * @brief Set the URL of the current Live Share session for a project
     * @param urlID ID of the .collaburl file
     * @param url URL of the session, empty string to end the session
    **/
    public async setLiveShareURL(urlID: string, url: string) : Promise<void> {
        await this.drive.files.update({
            fileId: urlID,
            media: {
                mimeType: "text/plain",
                body: " " + url
            }
        });
    }

}