import { queryTraffic, queryAllUsersTraffic } from '../db/index.js';

export interface UserTraffic {
  name: string;
  upload: number;
  download: number;
}

export type TrafficPeriod = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

const PERIOD_MS: Record<Exclude<TrafficPeriod, 'all'>, number> = {
  hour:  60 * 60 * 1000,
  day:   24 * 60 * 60 * 1000,
  week:  7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year:  365 * 24 * 60 * 60 * 1000,
};

function sinceMs(period: TrafficPeriod): number | undefined {
  if (period === 'all') return undefined;
  // For 'hour' use 2× the bucket width to guarantee a full 60-min window
  // regardless of where within the current hourly bucket we are.
  const multiplier = period === 'hour' ? 2 : 1;
  return Date.now() - multiplier * PERIOD_MS[period];
}

export function queryUserStats(xrayUsername: string, period: TrafficPeriod = 'all'): UserTraffic {
  const record = queryTraffic(xrayUsername, sinceMs(period));
  return {
    name: xrayUsername,
    upload: record.upload,
    download: record.download,
  };
}

export function queryAllStats(period: TrafficPeriod = 'all'): UserTraffic[] {
  return queryAllUsersTraffic(sinceMs(period)).map(r => ({
    name: r.xray_username,
    upload: r.upload,
    download: r.download,
  }));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576)     return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024)         return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export const PERIOD_LABELS: Record<TrafficPeriod, string> = {
  hour:  '1ч',
  day:   '24ч',
  week:  '7д',
  month: '30д',
  year:  '1г',
  all:   'Всё',
};
