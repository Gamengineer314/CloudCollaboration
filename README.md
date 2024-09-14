# Cloud Collaboration

Cloud Collaboration offers real-time collaboration through the Live Share extension, with cloud storage on Google Drive.
It allows any participant to start working on a project at any time without having to schedule sessions or synchronize files with your team.
When connecting to a project, the extension automatically joins another participant's Live Share session, or creates a new one, with the latest version of the project files.

## Dependencies
- The [Live Share](https://marketplace.visualstudio.com/items?itemName=MS-vsliveshare.vsliveshare) extension.
- A Google account so the extension can access your Google Drive.

## Usage
- Create or join a project : open an empty folder, right-click in the file explorer, click on _Cloud Collaboration: Create Project_ or _Cloud Collaboration: Join Project_. This will create a _.collablaunch_ file, which contains the information needed by the extension to connect to the project.
- Connect to a project : open a _.collablaunch_ file and click on _Connect_. This will load the project and either join another participant's Live Share session or create a new one. You can then work on the project in the _Cloud Collaboration_ folder. All files outside of this folder will be ignored.
- Share the project : open the _.collabconfig_ file and invite collaborators by entering their e-mail address, or share the project globally and send them the link.
- Open a terminal : press _Terminal_ -> _New Terminal_. This will open a new terminal in a folder containing a copy of the project updated in real time. Each participant can create their own terminal to interact with the project.
- Disconnect : open the _.collablaunch_ file and click on _Disconnect_. This will exit the Live Share session, transfer it to another participant if you were the host, and unload the project.

![Example](media/CloudCollaboration.gif)

## Limitations
Because it depends on Live Share and Google Drive, Cloud Collaboration has some limitations : 
- Binary files : Live Share does not support binary files. Cloud Collaboration offers a limited support by encoding them as text files. These files will have a _.collab64_ extension. The unencoded version of the files are stored in a folder containing a copy of the project. By default, terminals you create when you are connected to a project open in this folder, so you can interact with both binary and text files from the terminal. This also means that you can't upload binary files by dragging them into the file explorer. To add binary files to a project, right-click in the file explorer and click on _Cloud Collaboration: Upload Files_.
- Upload and download speed : project files are stored on the owner's Google Drive. They have to be downloaded when loading the project and uploaded regularly when someone is working on the project. This can be quite slow. You can reduce the time it takes by carefully configuring your project in the _.collabconfig_ file. Files that match the rules defined in the _Ignored Files_ setting are not uploaded to Google Drive. For example, you can ignore temporary or compilation output files, or large files that rarely change if you share them with your team by other means. If you don't need to access them from the terminal, you can also move these files out of the _Cloud Collaboration_ folder.
The rest of the files are uploaded or downloaded in two groups : static files and dynamic files. Files that match the rules defined in the _Static Files_ settings are static, the other files are dynamic. If a file in a group is modified, all files in that group will need to be uploaded or downloaded. You should therefore set files that rarely change as static and files that you often need to modify as dynamic.