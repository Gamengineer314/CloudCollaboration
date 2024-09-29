import { Config } from "../Project";
import { LatexAddon } from "./Latex";


export const addons: Map<string, Addon> = new Map<string, Addon>([
    ["Latex", new LatexAddon()]
]);


export interface Addon {

    /**
     * @brief Activate the addon
    **/
    activate(host: boolean) : void;


    /**
     * @brief Deactivate the addon
    **/
    deactivate(host: boolean) : void;


    /**
     * @brief Modify the configuration settings if required by the addon
     * @param config Current configuration (will be modified by this method)
    **/
    defaultConfig(config: Config) : void;

}