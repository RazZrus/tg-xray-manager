import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { loadConfig } from '../config.js';

const PROTO_PATH = path.join(__dirname, '../../proto/stats.proto');

let clientCache: grpc.ServiceClientConstructor | null = null;

function getStatsClient() {
  const config = loadConfig();
  const host = `127.0.0.1:${config.statsPort}`;

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

  return new StatsService(host, grpc.credentials.createInsecure());
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

export async function queryUserStats(xrayUsername: string): Promise<UserTraffic> {
  return new Promise((resolve, reject) => {
    const client = getStatsClient();

    (client as unknown as {
      QueryStats: (
        req: { pattern: string; reset: boolean },
        cb: (err: Error | null, res: QueryStatsResponse) => void
      ) => void
    }).QueryStats(
      { pattern: `user>>>${xrayUsername}>>>traffic`, reset: false },
      (err, response) => {
        if (err) {
          // Stats API недоступен — возвращаем нули
          resolve({ name: xrayUsername, upload: 0, download: 0 });
          return;
        }

        let upload = 0;
        let download = 0;

        for (const stat of response?.stat ?? []) {
          const val = parseInt(stat.value || '0', 10) || 0;
          if (stat.name.includes('uplink')) upload = val;
          if (stat.name.includes('downlink')) download = val;
        }

        resolve({ name: xrayUsername, upload, download });
      }
    );
  });
}

export async function queryAllStats(): Promise<UserTraffic[]> {
  return new Promise((resolve, reject) => {
    const client = getStatsClient();

    (client as unknown as {
      QueryStats: (
        req: { pattern: string; reset: boolean },
        cb: (err: Error | null, res: QueryStatsResponse) => void
      ) => void
    }).QueryStats(
      { pattern: 'user>>>*>>>traffic', reset: false },
      (err, response) => {
        if (err) {
          resolve([]);
          return;
        }

        const statsMap: Record<string, { upload: number; download: number }> = {};

        for (const stat of response?.stat ?? []) {
          const parts = stat.name.split('>>>');
          if (parts.length < 3) continue;
          const username = parts[1];
          const val = parseInt(stat.value || '0', 10) || 0;

          if (!statsMap[username]) statsMap[username] = { upload: 0, download: 0 };
          if (stat.name.includes('uplink')) statsMap[username].upload = val;
          if (stat.name.includes('downlink')) statsMap[username].download = val;
        }

        resolve(
          Object.entries(statsMap).map(([name, s]) => ({ name, ...s }))
        );
      }
    );
  });
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}
