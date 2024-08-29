import * as vscode from "vscode";
import { Auth, drive_v3 } from "googleapis";
import { Server, createServer } from "http";
import { context } from "./extension";
import { CLIENT_ID, CLIENT_SECRET, PROJECT_NUMBER } from "./credentials";
import { Readable } from "stream";
import { randomString, showErrorWrap } from "./util";


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
        const randomState = randomString(32);
        GoogleDrive.server?.close();
        GoogleDrive.server = createServer(showErrorWrap(async (request, response) => {
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
                auth.getToken(code, showErrorWrap((error, tokens) => {
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
                }));
            }
            else {
                vscode.window.showErrorMessage("Authentication failed. Please try again.");
                response.end("Authentication failed. Please try again.");
            }
            GoogleDrive.server?.close();
            GoogleDrive.server = undefined;
        }));

        // Prompt URL
        const url = auth.generateAuthUrl({
            scope: SCOPE,
            access_type: "offline",
            state: randomState
        });

        GoogleDrive.server.listen(PORT, showErrorWrap(async () => {
            // Open prompt
            vscode.window.showInformationMessage("Please authenticate in the page opened in your browser");
            const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
            if (!opened) {
                vscode.window.showErrorMessage("Authentication failed : prompt not opened");
                GoogleDrive.server?.close();
                GoogleDrive.server = undefined;
            }
        }));
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
     * @brief Get the email address of the authenticated user
    **/
    public async getEmail() : Promise<string> {
        const user = await this.drive.about.get({ fields: "user" });
        if (!user.data.user || !user.data.user.emailAddress) {
            throw new Error("Failed to get user email");
        }
        return user.data.user.emailAddress;
    }


    /**
     * @brief Prompt the user to pick a Google Drive folder containing a project and authorize the extension to access it
    **/
    public async pickProject(callback: (project: GoogleDriveProject) => any ) : Promise<void> {
        let result = "";
        GoogleDrive.server?.close();
        GoogleDrive.server = createServer(showErrorWrap(async (request, response) => {
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
                    result = "Project pick failed : invalid project. Please select the .collabdynamic, the .collabstatic and the .collabstate files corresponding to the project you want to join.";
                }
                else if (request.url === "/response/canceled") {
                    vscode.window.showErrorMessage("Project pick failed : canceled");
                    result = "Project pick failed : canceled";
                }
                else {
                    const params = new URL(request.url, LOCALHOST).searchParams;
                    const dynamicID = params.get("dynamic");
                    const staticID = params.get("static");
                    const stateID = params.get("state");
                    const name = params.get("name");
                    if (!dynamicID || !staticID || !stateID || !name) {
                        return;
                    }
                    const folder = await this.drive.files.get({ fileId: dynamicID, fields: "parents" });
                    if (!folder.data.parents) {
                        return;
                    }
                    callback(new GoogleDriveProject(folder.data.parents[0], dynamicID, staticID, stateID, name));
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
        }));

        GoogleDrive.server.listen(PORT, showErrorWrap(async () => {
            // Open prompt
            vscode.window.showInformationMessage("Please pick a project in the page opened in your browser");
            const opened = await vscode.env.openExternal(vscode.Uri.parse(LOCALHOST));
            if (!opened) {
                vscode.window.showErrorMessage("Project pick failed : prompt not opened");
                GoogleDrive.server?.close();
                GoogleDrive.server = undefined;
            }
        }));
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
            .setMimeTypes("application/octet-stream,application/json")
            .setQuery("*.collabdynamic | *.collabstatic | *.collabstate");
        const picker = new google.picker.PickerBuilder()
            .addView(view)
            .setTitle("Select a project (.collabdynamic, .collabstatic and .collabstate files)")
            .setCallback(pickerCallback)
            .enableFeature(google.picker.Feature.NAV_HIDDEN)
            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
            .setAppId("${PROJECT_NUMBER}")
            .setOAuthToken("${(await this.auth.getAccessToken()).token}")
            .build();
        picker.setVisible(true);
    }

    async function pickerCallback(data) {
        if (data.action == google.picker.Action.PICKED) {
            const fileNames = data.docs.map(doc => doc.name);
            const name = fileNames[0].substring(0, fileNames[0].lastIndexOf("."));
            if (fileNames.length === 3 && fileNames.includes(name + ".collabdynamic") && fileNames.includes(name + ".collabstatic") && fileNames.includes(name + ".collabstate")) {
                const dynamic = data.docs[fileNames.indexOf(name + ".collabdynamic")];
                const static = data.docs[fileNames.indexOf(name + ".collabstatic")];
                const state = data.docs[fileNames.indexOf(name + ".collabstate")];
                await fetch("${LOCALHOST}/response?dynamic=" + dynamic.id + "&static=" + static.id + "&state=" + state.id + "&name=" + name);
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
     * @returns Created project
    **/
    public async createProject(name: string) : Promise<GoogleDriveProject> {
        const folder = await this.drive.files.create({
            requestBody: {
                name: name,
                mimeType: "application/vnd.google-apps.folder"
            },
            fields: "id"
        });
        if (!folder.data.id) {
            throw new Error("Failed to create folder");
        }

        const dynamicFile = await this.drive.files.create({
            requestBody: {
                name: name + ".collabdynamic",
                mimeType: "application/octet-stream",
                parents: [folder.data.id]
            },
            media: {
                mimeType: "application/octet-stream",
                body: ""
            },
            fields: "id"
        });
        if (!dynamicFile.data.id) {
            await this.drive.files.delete({ fileId: folder.data.id });
            throw new Error("Failed to create .collabdynamic file");
        }

        const staticFile = await this.drive.files.create({
            requestBody: {
                name: name + ".collabstatic",
                mimeType: "application/octet-stream",
                parents: [folder.data.id]
            },
            media: {
                mimeType: "application/octet-stream",
                body: ""
            },
            fields: "id"
        });
        if (!staticFile.data.id) {
            await this.drive.files.delete({ fileId: folder.data.id });
            await this.drive.files.delete({ fileId: dynamicFile.data.id });
            throw new Error("Failed to create .collabstatic file");
        }

        const stateFile = await this.drive.files.create({
            requestBody: {
                name: name + ".collabstate",
                mimeType: "application/json",
                parents: [folder.data.id]
            },
            media: {
                mimeType: "application/json",
                body: JSON.stringify(new ProjectState())
            },
            fields: "id"
        });
        if (!stateFile.data.id) {
            await this.drive.files.delete({ fileId: folder.data.id });
            await this.drive.files.delete({ fileId: dynamicFile.data.id });
            await this.drive.files.delete({ fileId: staticFile.data.id });
            throw new Error("Failed to create .collaburl file");
        }

        return new GoogleDriveProject(folder.data.id, dynamicFile.data.id, staticFile.data.id, stateFile.data.id, name);
    }


    /**
     * @brief Get the state of a project
     * @param project Project to get the state for
     * @returns State of the project
    **/
    public async getState(project: GoogleDriveProject) : Promise<ProjectState> {
        const state = await this.drive.files.get({ fileId: project.stateID, alt: "media" });
        return state.data as ProjectState;
    }


    /**
     * @brief Set the state of a project
     * @param project Project to set the state for
     * @param state State of the project
    **/
    public async setState(project: GoogleDriveProject, state: ProjectState) : Promise<void> {
        await this.drive.files.update({
            fileId: project.stateID,
            media: {
                mimeType: "application/json",
                body: JSON.stringify(state)
            }
        });
    }


    /**
     * @brief Get the dynamic files of a project
     * @param project Project to get the dynamic files for
     * @returns Dynamic files of the project
    **/
    public async getDynamic(project: GoogleDriveProject) : Promise<Uint8Array> {
        const dynamicFile = await this.drive.files.get({ fileId: project.dynamicID, alt: "media" }, { responseType: "arraybuffer" });
        return new Uint8Array(dynamicFile.data as ArrayBuffer);
    }


    /**
     * @brief Set the dynamic files of a project
     * @param project Project to set the dynamic files for
     * @param dynamicFile Dynamic files of the project
    **/
    public async setDynamic(project: GoogleDriveProject, dynamicFile: Uint8Array) : Promise<void> {
        await this.drive.files.update({
            fileId: project.dynamicID,
            media: {
                mimeType: "application/octet-stream",
                body: Readable.from([dynamicFile])
            }
        });
    }


    /**
     * @brief Get the static files of a project
     * @param project Project to get the static files for
     * @returns Static files of the project
    **/
    public async getStatic(project: GoogleDriveProject) : Promise<Uint8Array> {
        const staticFile = await this.drive.files.get({ fileId: project.staticID, alt: "media" }, { responseType: "arraybuffer" });
        return new Uint8Array(staticFile.data as ArrayBuffer);
    }


    /**
     * @brief Set the static files of a project
     * @param project Project to set the static files for
     * @param staticFile Static files of the project
    **/
    public async setStatic(project: GoogleDriveProject, staticFile: Uint8Array) : Promise<void> {
        await this.drive.files.update({
            fileId: project.staticID,
            media: {
                mimeType: "application/octet-stream",
                body: Readable.from([staticFile])
            }
        });
    }


    /**
     * @brief Share a project with a user
     * @param project The project
     * @param email Email of the user
     * @returns Permission ID
    **/
    public async userShare(project: GoogleDriveProject, email: string) : Promise<Permission> {
        const permission = await this.drive.permissions.create({
            fileId: project.folderID,
            requestBody: {
                role: "writer",
                type: "user",
                emailAddress: email
            },
            fields: "id"
        });
        if (!permission.data.id) {
            throw new Error("Failed to create permission");
        }
        return new Permission(email, permission.data.id);
    }


    /**
     * @brief Share a project publicly
     * @param project The project
     * @returns Permission ID
    **/
    public async publicShare(project: GoogleDriveProject) : Promise<Permission> {
        const permission = await this.drive.permissions.create({
            fileId: project.folderID,
            requestBody: {
                role: "writer",
                type: "anyone"
            },
            fields: "id"
        });
        if (!permission.data.id) {
            throw new Error("Failed to create permission");
        }
        const url = await this.drive.files.get({ fileId: project.folderID, fields: "webViewLink" });
        if (!url.data.webViewLink) {
            throw new Error("Failed to get public link");
        }
        return new Permission(url.data.webViewLink, permission.data.id);
    }


    /**
     * @brief Cancel sharing of a project
     * @param project The project
     * @param id The permission to cancel
    **/
    public async unshare(project: GoogleDriveProject, permission: Permission) : Promise<void> {
        await this.drive.permissions.delete({ fileId: project.folderID, permissionId: permission.id });
    }
    
}



export class GoogleDriveProject {
    public constructor(
        public folderID: string, 
        public dynamicID: string, 
        public staticID: string, 
        public stateID: string, 
        public name: string
    ) {}
}



export class Permission {
    public constructor(
        public name: string, // user email or public link
        public id: string
    ) {}
}



export class ProjectState {
    public dynamicVersion: number = 0;
    public staticVersion: number = 0;
    public url: string = "";
}