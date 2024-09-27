import { Config } from "../Project";
import { LatexAddon } from "./Latex";


export const addons: Map<string, Addon> = new Map<string, Addon>([
    ["Latex", new LatexAddon()]
]);


export interface Addon {

    /**
     * @brief Activate the addon
    **/
    activate() : void;


    /**
     * @brief Deactivate the addon
    **/
    deactivate() : void;


    /**
     * @brief Modify the project.json settings if required by the addon
     * @param settings Current settings (will be modified by this method)
    **/
    modifySettings(settings: any) : void;


    /**
     * @brief Modify configuration settings if required by the addon
     * @param config Current configuration (will be modified by this method)
    **/
    modifyConfig(config: Config) : void;

}