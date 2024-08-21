# Cloud Collaboration

Cloud Collaboration provides real-time collaboration using the Live Share extension, with cloud storage on Google Drive.
This allows any participants to easily start working on a project at any time.
When connecting to a project, the extension will either join the Live Share session of another participant, or create a new one if needed.

## Dependencies
The [Live Share](https://marketplace.visualstudio.com/items?itemName=MS-vsliveshare.vsliveshare) extension is required for EPLCollab to work.
You will also need a Google account so the extension can access your Google Drive.

## Usage
- Authenticate : press Ctrl + Shift + p, then run the "Cloud Collaboration: Authenticate" command
- Create or join a project : open an empty folder, press Ctrl + Shift + p, then run the "Cloud Collaboration: Create project" or "Cloud Collaboration: Join project" command. This will create a .collabconfig file, which is a project configuration file.
- Connect to a project : open a folder with only a .collabconfig file, open the .collabconfig file and press on "Connect" (or run the "Cloud Collaboration: Connect" command). This will load the project and either join the Live Share session of another participant, or create a new one if needed.
- Disconnect : open the .collabconfig file and press on "Disconnect" (or run the "Cloud Collaboration: Disconnect" command). This will exit the Live Share session, transfer it to another participant if you were the host, and unload the project.


## Setup (for developers)
- Install Node packages used in the project : 
    ```bash
    npm i
    ```
- Create a new project in the [Google Cloud Console](https://console.cloud.google.com/projectcreate).
- Go to "APIs & Services" -> "Enabled APIs & services" -> "ENABLE APIS AND SERVICES" and enable "Google Drive API" and "Google Picker API".
- Go to "APIs & Services" -> "OAuth consent screen" and setup a consent screen with scopes "drive.file".
- Go to "APIs & Services" -> "Credentials" -> "CREATE CREDENTIALS" and create an API key and a web application OAuth client ID. Add "http://localhost:31415" and "http://127.0.0.1:31415" to "Authorized JavaScript origins" and "Authorized redirect URIs".
- Create a new file `src/credentials.ts` containing :
    ```ts
    export const CLIENT_ID = "<YOUR_CLIENT_ID>";
    export const CLIENT_SECRET = "<YOUR_CLIENT_SECRET>";
    export const API_KEY = "<YOUR_API_KEY>";
    export const PROJECT_NUMBER = "<YOUR_PROJECT_NUMBER>";
    ```
    Replace `<YOUR_CLIENT_ID>`, `<YOUR_CLIENT_SECRET>`, `<YOUR_API_KEY>` and `<YOUR_PROJECT_NUMBER>` by the credentials you created (you can find the project number in "IAM & Admin" -> "Settings").

## To do
- Live Share API
- Create and join project commands
- Loading and unloading of project files
- Frequent backups (on Google Drive and also locally to not load the entire project every time)
- Transfer Live Share session if host disconnects
- Option to delete a project
- Option to copy a project
- Custom editor for .collabconfig file (project name, Connect and Disconnect button and other settings)
- Sharing settings in .collabconfig file (add participants manually or allow anyone with the id to join)
- Ignore settings (similar to .gitignore for git) in .collabconfig file
- Publish the extension on the marketplace