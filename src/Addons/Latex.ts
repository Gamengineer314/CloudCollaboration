import * as vscode from "vscode";
import { Addon } from "./Addon";
import { Project, Config } from "../Project";
import { fileUri } from "../util";


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

    public activate() : void {
        // Check if Latex Workshop is installed
        if (!vscode.extensions.getExtension("james-yu.latex-workshop")) {
            vscode.window.showErrorMessage("Cloud Collaboration is compatible with the LaTeX Workshop extension to compile LaTeX projects. You should consider installing it.", "LaTeX Workshop").then(value => {
                if (value === "LaTeX Workshop") {
                    vscode.commands.executeCommand("extension.open", "james-yu.latex-workshop");
                }
            });
        }
    }


    public modifySettings(config: Config, settings: any) : void {
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

        // Custom recipe settings for building in project folder
        if (Array.isArray(settings["latex-workshop.latex.recipes"])) {
            settings["latex-workshop.latex.recipes"] = settings["latex-workshop.latex.recipes"].filter(
                recipe => recipe.name !== "cloud-collaboration"
            );
        }
        else {
            settings["latex-workshop.latex.recipes"] = [];
        }
        settings["latex-workshop.latex.recipes"].push({
            "name": "cloud-collaboration",
            "tools": [
                "cloud-collaboration"
            ]
        });

        if (Array.isArray(settings["latex-workshop.latex.tools"])) {
            settings["latex-workshop.latex.tools"] = settings["latex-workshop.latex.tools"].filter(
                tool => tool.name !== "cloud-collaboration"
            );
        }
        else {
            settings["latex-workshop.latex.tools"] = [];
        }
        settings["latex-workshop.latex.tools"].push({
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

        settings["latex-workshop.latex.outDir"] = fileUri("out", Project.instance!.projectFolder).fsPath;
        vscode.workspace.fs.createDirectory(fileUri("out", Project.instance!.projectFolder));
    }


    public cancelSettings(_config: Config, settings: any): void {
        // Remove custom recipe settings
        if (Array.isArray(settings["latex-workshop.latex.recipes"])) {
            settings["latex-workshop.latex.recipes"] = settings["latex-workshop.latex.recipes"].filter(
                recipe => recipe.name !== "cloud-collaboration"
            );
        }
        if (Array.isArray(settings["latex-workshop.latex.tools"])) {
            settings["latex-workshop.latex.tools"] = settings["latex-workshop.latex.tools"].filter(
                tool => tool.name !== "cloud-collaboration"
            );
        }
        delete settings["latex-workshop.latex.outDir"];
    }


    public deactivate() : void {}

}