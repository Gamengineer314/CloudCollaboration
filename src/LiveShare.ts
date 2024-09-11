import * as vscode from "vscode";
import * as vlsl from "vsls";
import { waitFor } from "./util";


export class LiveShare {

    private static _instance : LiveShare | undefined = undefined;
    public static get instance() : LiveShare | undefined { return LiveShare._instance; }


    private liveShare : vlsl.LiveShare;

    private constructor(liveShare: vlsl.LiveShare) {
        this.liveShare = liveShare;
    }


    /**
     * @brief Activate Live Share class
    **/
    public static async activate() : Promise<void> {
        // Check instance
        if (LiveShare._instance) {
            throw new Error("LiveShare initialization failed : already initialized");
        }

        // Get Live Share API if available
        const liveShare = await vlsl.getApi();
        if (!liveShare) {
            throw new Error("LiveShare initialization failed : Live Share not available");
        }

        LiveShare._instance = new LiveShare(liveShare);
        vscode.commands.executeCommand("setContext", "cloud-collaboration.liveShareAvailable", true);
    }
    
    
    /**
     * @brief Create a new Live Share session
     * @returns Session URL to share with collaborators
    **/
    public async createSession() : Promise<string> {
        await this.liveShare.share();
        if (!this.liveShare.session.id) {
            throw new Error("Failed to create Live Share session");
        }
        return "https://prod.liveshare.vsengsaas.visualstudio.com/join?" + this.liveShare.session.id;
    }


    /**
     * @brief Join a Live Share session
     * @param url Session URL
    **/
    public async joinSession(url: string) : Promise<void> {
        await this.liveShare.join(vscode.Uri.parse(url));
    }


    /**
     * @brief End or leave the current Live Share session
    **/
    public async exitSession() : Promise<void> {
        await this.liveShare.end();
    }


    /**
     * @brief Wait for the session to be joined
    **/
    public async waitForSession() : Promise<void> {
        await waitFor(() => this.liveShare.session.id !== null);
    }

}