import * as vscode from "vscode";
import * as vlsl from "vsls/vscode";
import { waitFor } from "./util";


export class LiveShare {

    private static _instance : LiveShare | undefined = undefined;
    public static get instance() : LiveShare | undefined { return LiveShare._instance; }

    private liveShare : vlsl.LiveShare;
    public get sessionId() : string | null { return this.liveShare.session.id; };

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
        const liveShare = await vlsl.getApi("cloud-collaboration");
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
        if (this.liveShare.session.id) {
            throw new Error("Can't create Live Share session : already in a session");
        }
        console.log(await this.liveShare.share({ suppressNotification: true }));
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
        if (this.liveShare.session.id) {
            throw new Error("Can't create Live Share session : already in a session");
        }
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


    /**
     * @brief Get a session id from its url
     * @param url Url of the session
     * @returns Id of the session
    **/
    public static getId(url: string) : string {
        return url.substring(55);
    }

    /**
     * @brief Get a session url from its id
     * @param id Id of the session
     * @returns Url of the session
    **/
    public static getUrl(id: string) : string {
        return "https://prod.liveshare.vsengsaas.visualstudio.com/join?" + id;
    }

}