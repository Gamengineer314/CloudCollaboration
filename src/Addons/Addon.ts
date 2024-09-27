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
     * @brief Modify the configuration and project.json settings if required by the addon
     * @param settings Current settings (will be modified by this method)
    **/
    modifySettings(config: Config, settings: any) : void;


    /**
     * @brief Cancel modifications to the configuration and project.json settings
     * @param settings Current settings (will be modified by this method)
    **/
    cancelSettings(config: Config, settings: any) : void;

}