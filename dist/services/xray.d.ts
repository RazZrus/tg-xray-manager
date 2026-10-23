export interface XrayUser {
    name: string;
    upload: string;
    download: string;
}
export declare function listUsers(): XrayUser[];
export declare function addUser(name: string): string;
export declare function deleteUser(name: string): void;
export declare function getUserLink(name: string): string;
export declare function getUserQrPath(name: string): string;
export declare function getUserStats(name: string): string;
export declare function getBlockedStats(user?: string, period?: string): string;
export declare function getXrayStatus(): string;
export declare function restartXray(): void;
export declare function runShellCommand(command: string): string;
export declare function rebootServer(): void;
export declare function shutdownServer(): void;
//# sourceMappingURL=xray.d.ts.map