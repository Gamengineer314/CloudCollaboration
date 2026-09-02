import * as vscode from "vscode";
import * as vlsl from "vsls/vscode";
import { showErrorWrap, waitFor } from "./util";


export class LiveShare {

    private sessionId : string | null = null;
    private userIndex : number = 0;
    private changePeerDisposable : vscode.Disposable | undefined = undefined;
    private changeSessionDisposable : vscode.Disposable | undefined = undefined;

    private constructor(private liveShare: vlsl.LiveShare) {}


    /**
     * @brief Url of the current session
    **/
    public get sessionUrl() : string | null { 
        return this.sessionId === null ? null : "https://prod.liveshare.vsengsaas.visualstudio.com/join?" + this.sessionId; 
    };


    /**
     * @brief Get a LiveShare instance
    **/
    public static async get() : Promise<LiveShare> {
        const liveShare = await vlsl.getApi("cloud-collaboration");
        if (!liveShare) {
            throw new Error("LiveShare initialization failed : Live Share not available");
        }
        return new LiveShare(liveShare);
    }


    /**
     * @brief Register callbacks
     * @param onIndexChanged
     * Called when the user index changes.
     * Indices are always consecutive and start at 0 for the host.
     * @param onSessionEnd Called when the session ends
    **/
    public setCallbacks(onIndexChanged: (userIndex: number) => void | Promise<void> = () => {}, onSessionEnd : () => void | Promise<void> = () => {}) {
        this.changePeerDisposable = this.liveShare.onDidChangePeers(showErrorWrap(_ => {
            if (this.liveShare.session.id !== null) {
                const oldIndex = this.userIndex;
                this.userIndex = this.liveShare.peers
                    .sort((p1, p2) => p1.peerNumber - p2.peerNumber)
                    .findIndex(peer => peer.peerNumber === this.liveShare.session.peerNumber);
                if (oldIndex !== this.userIndex) {
                    onIndexChanged(this.userIndex);
                }
            }
        }));
        this.changeSessionDisposable = this.liveShare.onDidChangeSession(showErrorWrap(_ => {
            if (this.liveShare.session.id === null && this.sessionId !== null) {
                onSessionEnd();
            }
            this.sessionId = this.liveShare.session.id;
        }));
        onIndexChanged(this.userIndex);
    }


    /**
     * @brief Dispose callbacks if [setCallbacks] was called
    **/
    public async disposeCallbacks() : Promise<void> {
        this.changePeerDisposable?.dispose();
        this.changeSessionDisposable?.dispose();
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
        this.sessionId = this.liveShare.session.id;
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