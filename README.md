# Cloud Collaboration

Cloud Collaboration offers real-time collaboration through the Live Share extension, with cloud storage using Git automatically.
It allows any participant to start working on a project at any time without having to schedule sessions or synchronize files with your team.
When connecting to a project, the extension automatically joins another participant's Live Share session, or creates a new one, with the latest version of the project files.

## Dependencies
- The [Live Share](https://marketplace.visualstudio.com/items?itemName=MS-vsliveshare.vsliveshare) extension.
- [Git](https://git-scm.com/).
- A [GitHub](https://github.com/) account, or any other Git hosting service.

## Usage
- Create a project on GitHub : [create a new repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository#creating-a-new-repository-from-the-web-ui), and [add your collaborators](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/repository-access-and-collaboration/inviting-collaborators-to-a-personal-repository#inviting-a-collaborator-to-a-personal-repository).
- Join the project in VSCode : open an empty folder, right-click in the file explorer, and click on _Cloud Collaboration: Join Project_. Enter your [credentials](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-authentication-to-github#authenticating-with-the-command-line) to authenticate to GitHub, as well as your name and email to author Git commits. This will clone the repository in a hidden folder managed by the extension.
- Connect to a project : right-click in the file explorer, and click on _Cloud Collaboration: Connect_. This will load the project and either join another participant's Live Share session or create a new one. You can then work on the project in the _Project_ folder. Any files outside this folder will be ignored.
- Open a terminal : click on _Terminal: New Terminal_. This will open a new terminal in a folder containing a copy of the project updated in real-time. Each participant can create their own terminal to interact with the project.
- Disconnect : right-click in the file explorer, and click on _Cloud Collaboration: Disconnect_. This will exit the Live Share session, transfer it to another participant if you were the host, and unload the project. Don't forget this step ! Closing the VSCode window or ending the Live Share session without disconnecting could cause data loss.

## Warning
The extension hasn't yet been extensively tested, so it may still contain bugs. Furthermore, it's built on top of many workarounds to solve issues arising from the use of Live Share and Git instead of custom real-time collaboration and cloud storage tools. Therefore, there are still some missing features and known issues for which no solution has yet been found. If you encounter any bugs, please report them on [GitHub](https://github.com/Gamengineer314/CloudCollaboration/issues).

## Limitations
- Binary files : Live Share doesn't support binary files. Cloud Collaboration offers a limited support by encoding them as text files. These files will have a _.collab64_ extension. The unencoded version of the files are stored in a folder containing a copy of the project. By default, terminals that are created when connected to a project open in this folder, so you can interact with both binary and text files from the terminal. This also means that you can't upload binary files by dragging them into the file explorer. To add binary files to a project, right-click in the file explorer and click on _Cloud Collaboration: Upload Files_.
- Git history : the goal of Cloud Collaboration is not to maintain a clean Git history. The extension simply regularly commits and pushes all changes to the project files, as well as the current Live Share URL when the host changes. This results in a large number of disorganised commits. It could also cause the .git folder to grow faster than it would if Git were used normally.