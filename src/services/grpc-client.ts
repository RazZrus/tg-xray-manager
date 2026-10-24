import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { loadConfig } from '../config.js';

const PROTO_PATH = path.join(__dirname, '../../proto/stats.proto');

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
const statsNs = app?.['stats'] as Record<string, unknown>;
const command = statsNs?.['command'] as Record<string, unknown>;
const StatsServiceConstructor = command?.['StatsService'] as grpc.ServiceClientConstructor;

export interface StatsClient extends grpc.Client {
  QueryStats(
    req: { pattern: string; reset: boolean },
    cb: (err: Error | null, res: { stat: { name: string; value: string }[] }) => void
  ): void;
}

let cachedClient: StatsClient | null = null;
let cachedHost: string | null = null;

export function getStatsClient(): StatsClient {
  const config = loadConfig();
  const host = `127.0.0.1:${config.statsPort}`;

  if (cachedClient && cachedHost === host) return cachedClient;
  if (cachedClient) cachedClient.close();

  cachedClient = new StatsServiceConstructor(host, grpc.credentials.createInsecure()) as unknown as StatsClient;
  cachedHost = host;
  return cachedClient;
}

export function resetStatsClient(): void {
  if (cachedClient) {
    cachedClient.close();
    cachedClient = null;
    cachedHost = null;
  }
}
