export interface Config {
    botToken: string;
    adminIds: number[];
    serverIp: string;
    xrayPort: number;
    sni: string;
    statsPort: number;
}
export declare function configExists(): boolean;
export declare function loadConfig(): Config;
export declare function saveConfig(config: Config): void;
//# sourceMappingURL=config.d.ts.map