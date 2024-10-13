import * as vscode from "vscode";
import * as vlsl from "vsls/vscode";
import { showErrorWrap, waitFor } from "./util";


export class LiveShare {

    private static _instance : LiveShare | undefined = undefined;
    public static get instance() : LiveShare | undefined { return LiveShare._instance; }

    private liveShare : vlsl.LiveShare;
    private sessionId : string | null = null;
    private userIndex : number = 0;
    private _onIndexChanged : (userIndex: number) => void | Promise<void> = () => {};
    private _onSessionEnd : () => void | Promise<void> = () => {};
    private disposables : vscode.Disposable[] = [];

    private constructor(liveShare: vlsl.LiveShare) {
        this.liveShare = liveShare;
    }


    /**
     * @brief Url of the current session
    **/
    public get sessionUrl() : string | null { 
        return this.sessionId === null ? null : "https://prod.liveshare.vsengsaas.visualstudio.com/join?" + this.sessionId; 
    };


    /**
     * @brief
     * Register a callback to be called when the user index changes.
     * Indices are always consecutive and start at 0 for the host.
    **/
    public set onIndexChanged(onIndexChanged: (index: number) => void | Promise<void>) {
        this._onIndexChanged = onIndexChanged;
        onIndexChanged(this.userIndex);
    };


    /**
     * @brief Register a callback to be called when the session ends
    **/
    public set onSessionEnd(onSessionEnd: () => void | Promise<void>) {
        this._onSessionEnd = onSessionEnd;
    }


    /**
     * @brief Activate LiveShare class if it wasn't already
    **/
    public static async activate() : Promise<void> {
        // Check instance
        if (LiveShare._instance) {
            return;
        }

        // Get Live Share API if available
        const liveShare = await vlsl.getApi("cloud-collaboration");
        if (!liveShare) {
            throw new Error("LiveShare initialization failed : Live Share not available");
        }

        // Update sessionId and userIndex
        const instance = new LiveShare(liveShare);
        instance.disposables.push(liveShare.onDidChangePeers(showErrorWrap(_ => {
            if (instance.liveShare.session.id !== null) {
                const oldIndex = instance.userIndex;
                instance.userIndex = instance.liveShare.peers
                    .sort((p1, p2) => p1.peerNumber - p2.peerNumber)
                    .findIndex(peer => peer.peerNumber === instance.liveShare.session.peerNumber);
                if (oldIndex !== instance.userIndex) {
                    instance._onIndexChanged(instance.userIndex);
                }
            }
        })));
        instance.disposables.push(liveShare.onDidChangeSession(showErrorWrap(_ => {
            if (instance.liveShare.session.id === null && instance.sessionId !== null) {
                instance._onSessionEnd();
            }
            instance.sessionId = instance.liveShare.session.id;
        })));

        LiveShare._instance = instance;
        vscode.commands.executeCommand("setContext", "cloud-collaboration.liveShareAvailable", true);
    }


    /**
     * @brief Deactivate LiveShare class
    **/
    public static async deactivate() : Promise<void> {
        if (LiveShare._instance) {
            for (const disposable of LiveShare._instance.disposables) {
                disposable.dispose();
            }
            LiveShare._instance = undefined;
            vscode.commands.executeCommand("setContext", "cloud-collaboration.liveShareAvailable", false);
        }
    }
    
    
    /**
     * @brief Create a new Live Share session
    **/
    public async createSession() : Promise<void> {
        if (this.liveShare.session.id) {
            throw new Error("Can't create Live Share session : already in a session");
        }
        await this.liveShare.share();
        if (!this.liveShare.session.id) {
            throw new Error("Failed to create Live Share session");
        }
        this.sessionId = this.liveShare.session.id;
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
     * @brief Check if a session is valid
     * @param sessionUrl The URL of the session
    **/
    public static async checkSession(sessionUrl: string) : Promise<boolean> {
        // Get anonymous access token
        let response = await fetch("https://prod.liveshare.vsengsaas.visualstudio.com/auth/anonymous-token", { method: "POST" });
        if (!response.ok) {
            throw new Error("Failed to verify session : " + response.statusText);
        }
        const data: any = await response.json();
        if (!data.hasOwnProperty("access_token")) {
            throw new Error("Failed to verify session : no token");
        }
        const token = data.access_token;
        
        // Check session
        response = await fetch(`https://prod.liveshare.vsengsaas.visualstudio.com/api/v1.2/workspace/${sessionUrl.substring(55)}/user`, {
            method: "PUT",
            headers: {
                authorization: `Bearer ${token}`
            }
        });
        if (response.status === 200) {
            return true;
        }
        if (response.status === 404) {
            return false;
        }
        else {
            throw new Error("Failed to verify session : " + response.statusText);
        }
    }

}