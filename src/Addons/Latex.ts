import * as vscode from "vscode";
import { Addon } from "./Addon";
import { Project, Config } from "../Project";
import { fileUri } from "../util";
import { currentFolder } from "../extension";


const defaultIgnoreRules = [
    "out/**"
];

const defaultStaticRules = [
    "**.png",
    "**.jpg",
    "**.jpeg",
    "**.pdf",
    "**.svg"
];


export class LatexAddon implements Addon {

    public activate(host: boolean) : void {
        // Check if Latex Workshop is installed
        if (!vscode.extensions.getExtension("james-yu.latex-workshop")) {
            vscode.window.showErrorMessage("Cloud Collaboration is compatible with the LaTeX Workshop extension to compile LaTeX projects. You should consider installing it.", "LaTeX Workshop").then(value => {
                if (value === "LaTeX Workshop") {
                    vscode.commands.executeCommand("extension.open", "james-yu.latex-workshop");
                }
            });
        }

        // Custom recipe for building LaTeX projects
        if (host) {
            let recipes: any = vscode.workspace.getConfiguration("latex-workshop", currentFolder).inspect("latex.recipes")?.workspaceFolderValue;
            if (!recipes || !Array.isArray(recipes)) {
                recipes = [];
            }
            recipes.push({
                "name": "cloud-collaboration",
                "tools": [
                    "cloud-collaboration"
                ]
            });
            vscode.workspace.getConfiguration("latex-workshop", currentFolder).update("latex.recipes", recipes);

            let tools: any = vscode.workspace.getConfiguration("latex-workshop", currentFolder).inspect("latex.tools")?.workspaceFolderValue;
            if (!tools || !Array.isArray(tools)) {
                tools = [];
            }
            tools.push({
                "name": "cloud-collaboration",
                "command": "latexmk",
                "args": [
                    "-synctex=1",
                    "-interaction=nonstopmode",
                    "-file-line-error",
                    "-pdf",
                    `-outdir=%OUTDIR%`,
                    "-cd",
                    fileUri("%RELATIVE_DOC%", Project.instance!.storageFolder).fsPath
                ],
                "env": {}
            });
            vscode.workspace.getConfiguration("latex-workshop", currentFolder).update("latex.tools", tools);

            vscode.workspace.getConfiguration("latex-workshop", currentFolder).update("latex.outDir", fileUri("out", Project.instance!.projectFolder).fsPath);
            vscode.workspace.fs.createDirectory(fileUri("out", Project.instance!.projectFolder));
            vscode.workspace.getConfiguration("latex-workshop", currentFolder).update("latex.autoBuild.run", "onSave");
        }
    }


    public deactivate(host: boolean) : void {
        // Remove custom recipe settings
        if (host) {
            let recipes: any = vscode.workspace.getConfiguration("latex-workshop", currentFolder).get("latex.recipes");
            if (recipes && Array.isArray(recipes)) {
                recipes = recipes.filter(recipe => recipe.name !== "cloud-collaboration");
                if (recipes.length === 0) {
                    recipes = undefined;
                }
                vscode.workspace.getConfiguration("latex-workshop", currentFolder).update("latex.recipes", recipes);
            }

            let tools: any = vscode.workspace.getConfiguration("latex-workshop", currentFolder).get("latex.tools");
            if (tools && Array.isArray(tools)) {
                tools = tools.filter(tool => tool.name !== "cloud-collaboration");
                if (tools.length === 0) {
                    tools = undefined;
                }
                vscode.workspace.getConfiguration("latex-workshop", currentFolder).update("latex.tools", tools);
            }

            vscode.workspace.getConfiguration("latex-workshop", currentFolder).update("latex.outDir", undefined);
            vscode.workspace.getConfiguration("latex-workshop", currentFolder).update("latex.autoBuild.run", undefined);
        }
    }


    public defaultConfig(config: Config) : void {
        // Default ignore and static rules
        for (const rule of defaultIgnoreRules) {
            if (!config.filesConfig.ignoreRules.includes(rule)) {
                config.filesConfig.ignoreRules.push(rule);
            }
        }
        for (const rule of defaultStaticRules) {
            if (!config.filesConfig.staticRules.includes(rule)) {
                config.filesConfig.staticRules.push(rule);
            }
        } 
    }

}