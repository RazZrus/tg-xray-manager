"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.queryUserStats = queryUserStats;
exports.queryAllStats = queryAllStats;
exports.formatBytes = formatBytes;
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const path_1 = __importDefault(require("path"));
const config_js_1 = require("../config.js");
const PROTO_PATH = path_1.default.join(__dirname, '../../proto/stats.proto');
let cachedClient = null;
let cachedHost = null;
function getStatsClient() {
    const config = (0, config_js_1.loadConfig)();
    const host = `127.0.0.1:${config.statsPort}`;
    if (cachedClient && cachedHost === host) {
        return cachedClient;
    }
    if (cachedClient) {
        cachedClient.close();
    }
    const packageDef = protoLoader.loadSync(PROTO_PATH, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
    });
    const proto = grpc.loadPackageDefinition(packageDef);
    const pkg = proto['xray'];
    const app = pkg?.['app'];
    const stats = app?.['stats'];
    const command = stats?.['command'];
    const StatsService = command?.['StatsService'];
    cachedClient = new StatsService(host, grpc.credentials.createInsecure());
    cachedHost = host;
    return cachedClient;
}
function callQueryStats(pattern) {
    return new Promise((resolve) => {
        const client = getStatsClient();
        client.QueryStats({ pattern, reset: false }, (err, response) => {
            if (err) {
                resolve({ stat: [] });
                return;
            }
            resolve(response ?? { stat: [] });
        });
    });
}
function parseTrafficStats(stats) {
    const result = new Map();
    for (const stat of stats) {
        const parts = stat.name.split('>>>');
        if (parts.length < 4)
            continue;
        const username = parts[1];
        const val = parseInt(stat.value || '0', 10) || 0;
        if (!result.has(username))
            result.set(username, { upload: 0, download: 0 });
        const entry = result.get(username);
        if (stat.name.includes('uplink'))
            entry.upload = val;
        if (stat.name.includes('downlink'))
            entry.download = val;
    }
    return result;
}
async function queryUserStats(xrayUsername) {
    const response = await callQueryStats(`user>>>${xrayUsername}>>>traffic`);
    const statsMap = parseTrafficStats(response.stat);
    const entry = statsMap.get(xrayUsername);
    return {
        name: xrayUsername,
        upload: entry?.upload ?? 0,
        download: entry?.download ?? 0,
    };
}
async function queryAllStats() {
    const response = await callQueryStats('user>>>*>>>traffic');
    const statsMap = parseTrafficStats(response.stat);
    return Array.from(statsMap.entries()).map(([name, s]) => ({ name, ...s }));
}
function formatBytes(bytes) {
    if (bytes >= 1_073_741_824)
        return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
    if (bytes >= 1_048_576)
        return `${(bytes / 1_048_576).toFixed(1)} MB`;
    if (bytes >= 1_024)
        return `${(bytes / 1_024).toFixed(1)} KB`;
    return `${bytes} B`;
}
//# sourceMappingURL=stats.js.map