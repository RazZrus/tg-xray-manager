import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { loadConfig } from '../config.js';

const PROTO_PATH = path.join(__dirname, '../../proto/stats.proto');

let cachedClient: grpc.Client | null = null;
let cachedHost: string | null = null;

interface StatsClient extends grpc.Client {
  QueryStats(
    req: { pattern: string; reset: boolean },
    cb: (err: Error | null, res: QueryStatsResponse) => void
  ): void;
}

function getStatsClient(): StatsClient {
  const config = loadConfig();
  const host = `127.0.0.1:${config.statsPort}`;

  if (cachedClient && cachedHost === host) {
    return cachedClient as StatsClient;
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

  const proto = grpc.loadPackageDefinition(packageDef) as Record<string, unknown>;
  const pkg = proto['xray'] as Record<string, unknown>;
  const app = pkg?.['app'] as Record<string, unknown>;
  const stats = app?.['stats'] as Record<string, unknown>;
  const command = stats?.['command'] as Record<string, unknown>;
  const StatsService = command?.['StatsService'] as grpc.ServiceClientConstructor;

  cachedClient = new StatsService(host, grpc.credentials.createInsecure());
  cachedHost = host;
  return cachedClient as StatsClient;
}

interface Stat {
  name: string;
  value: string;
}

interface QueryStatsResponse {
  stat: Stat[];
}

export interface UserTraffic {
  name: string;
  upload: number;
  download: number;
}

function callQueryStats(pattern: string): Promise<QueryStatsResponse> {
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

function parseTrafficStats(stats: Stat[]): Map<string, { upload: number; download: number }> {
  const result = new Map<string, { upload: number; download: number }>();

  for (const stat of stats) {
    const parts = stat.name.split('>>>');
    if (parts.length < 4) continue;
    const username = parts[1];
    const val = parseInt(stat.value || '0', 10) || 0;

    if (!result.has(username)) result.set(username, { upload: 0, download: 0 });
    const entry = result.get(username)!;
    if (stat.name.includes('uplink')) entry.upload = val;
    if (stat.name.includes('downlink')) entry.download = val;
  }

  return result;
}

export async function queryUserStats(xrayUsername: string): Promise<UserTraffic> {
  const response = await callQueryStats(`user>>>${xrayUsername}>>>traffic`);
  const statsMap = parseTrafficStats(response.stat);
  const entry = statsMap.get(xrayUsername);
  return {
    name: xrayUsername,
    upload: entry?.upload ?? 0,
    download: entry?.download ?? 0,
  };
}

export async function queryAllStats(): Promise<UserTraffic[]> {
  const response = await callQueryStats('user>>>*>>>traffic');
  const statsMap = parseTrafficStats(response.stat);
  return Array.from(statsMap.entries()).map(([name, s]) => ({ name, ...s }));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}
