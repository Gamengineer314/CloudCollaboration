## Setup
To start developing the extension :
- Clone the repository
- Install Node packages used in the project : 
    ```bash
    npm i
    ```
- Create a new project in the [Google Cloud Console](https://console.cloud.google.com/projectcreate).
- Go to "APIs & Services" -> "Enabled APIs & services" -> "ENABLE APIS AND SERVICES" and enable "Google Drive API" and "Google Picker API".
- Go to "APIs & Services" -> "OAuth consent screen" and setup a consent screen with scopes "drive.file".
- Go to "APIs & Services" -> "Credentials" -> "CREATE CREDENTIALS" and create a web application OAuth client ID. Add "http://localhost:31415" and "http://127.0.0.1:31415" to "Authorized JavaScript origins" and "Authorized redirect URIs".
- Create a new file `src/credentials.ts` containing :
    ```ts
    export const CLIENT_ID = "<YOUR_CLIENT_ID>";
    export const CLIENT_SECRET = "<YOUR_CLIENT_SECRET>";
    export const PROJECT_NUMBER = "<YOUR_PROJECT_NUMBER>";
    ```
    Replace `<YOUR_CLIENT_ID>`, `<YOUR_CLIENT_SECRET>` and `<YOUR_PROJECT_NUMBER>` by the credentials you created (you can find the project number in "IAM & Admin" -> "Settings").