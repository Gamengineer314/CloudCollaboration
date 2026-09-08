import { GitError, simpleGit, SimpleGit } from "simple-git";
import { context, currentFolder, storageFolder } from "./extension";


export class Git {

    private constructor(private git: SimpleGit) {}


    /**
     * @brief Get a Git instance for the current workspace
    **/
    public static async get() : Promise<Git> {
        return new Git(simpleGit(storageFolder.fsPath).env(await Git.getEnv()));
    }


    /**
     * @brief Clone a git repository in the current workspace's storage folder
     * @param url URL of the repository
     * @param config Configurations returned by [getHTTPConfig] or [getSSHConfig]
    **/
    public static async clone(url: string, config: [string, string][]) : Promise<void> {
        const git = simpleGit(storageFolder.fsPath, {
            config: config.map(c => c[0] + "=" + c[1]),
            unsafe: { allowUnsafeSshCommand: true, allowUnsafeCredentialHelper: true }
        }).env(await Git.getEnv());
        await git.clone(url, storageFolder.fsPath);
        for (const c of config) {
            await git.addConfig(c[0], c[1], true, "local");
        }
    }


    /**
     * @brief Detects which protocol a remote URL uses
     * @param url 
    **/
    public static detectProtocol(url: string) : "http" | "ssh" {
        return url.startsWith("http") ? "http" : "ssh";
    }


    /**
     * @brief Get configurations to authenticate to a remote over HTTP
     * @param username User's username
     * @param password User's password or token
     * @returns The configurations
    **/
    public static async getHTTPConfig(username: string, password: string) : Promise<[string, string][]> {
        await context.secrets.store("git_token_" + currentFolder.fsPath, password);
        return [
            ["credential.username", username],
            ["credential.helper", ""],
            ["credential.helper", '!f() { test "$1" = get && echo "password=$GIT_HTTP_TOKEN"; }; f']
        ];
    }
    
    /**
     * @brief Get configurations to authenticate to a remote over SSH
     * @param keyPath Path to the user's private SSH key
     * @returns The configurations
    **/
    public static getSSHConfig(keyPath: string) : [string, string][] {
        return [
            ["core.sshCommand", `ssh -i "${keyPath}" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`]
        ];
    }

    /**
     * @brief Get configurations to author commits
     * @param name User's name
     * @param email User's email
     * @returns The configurations
    **/
    public static getAuthorConfig(name: string, email: string) : [string, string][] {
        return [
            ["user.name", name],
            ["user.email", email]
        ];
    }

    private static async getEnv() : Promise<object> {
        return {
            GIT_TERMINAL_PROMPT: '0',
            GIT_HTTP_TOKEN: await context.secrets.get("git_token_" + currentFolder.fsPath)
        };
    }


    /**
     * @brief Get the user's global author configurations
    **/
    public static async getGlobalAuthor() : Promise<{name: string | null, email: string | null}> {
        const git = simpleGit();
        return {
            name: (await git.getConfig("user.name", "global")).value,
            email: (await git.getConfig("user.email", "global")).value,
        };
    }

    /**
     * @brief Pull commits from the remote
    **/
    public async pull() : Promise<void> {
        await this.git.fetch();
        const upstream = (await this.git.status()).tracking;
        if (upstream && await this.branchExists(upstream)) {
            await this.git.reset(["--hard", upstream]);
        }
    }


    /**
     * @brief Push commits to the remote
     * @returns Whether the push was rejected by the remote
    **/
    public async push() : Promise<boolean> {
        try {
            await this.git.push();
        }
        catch (error: any) {
            const message: string = error.message;
            if (message.includes("rejected")) {
                return true;
            }
            throw error;
        }
        return false;
    }


    /**
     * @brief Commit all changes
     * @param files Files to upload
     * @param message Commit message
    **/
    public async commit(files: string | string[], message: string) : Promise<void> {
        const status = await this.git.status();
        if (
            status.not_added.length > 0 ||
            status.created.length > 0 ||
            status.deleted.length > 0 ||
            status.modified.length > 0 ||
            status.renamed.length > 0
        ) {
            await this.git.add(files);
            await this.git.commit(message);
        }
    }


    /**
     * @brief Check if a branch exists
     * @param branch Branch name
     * @returns Whether the branch exists
    **/
    private async branchExists(branch: string): Promise<boolean> {
        try {
            await this.git.raw(["rev-parse", "--verify", branch]);
            return true;
        } catch {
            return false;
        }
    }

}