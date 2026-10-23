export interface UserTraffic {
    name: string;
    upload: number;
    download: number;
}
export declare function queryUserStats(xrayUsername: string): Promise<UserTraffic>;
export declare function queryAllStats(): Promise<UserTraffic[]>;
export declare function formatBytes(bytes: number): string;
//# sourceMappingURL=stats.d.ts.map