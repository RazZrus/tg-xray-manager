import { getStatsClient, resetStatsClient } from './grpc-client.js';
import { insertTrafficBatch } from '../db/index.js';

let consecutiveFailures = 0;

function collectAndReset(): Promise<void> {
  return new Promise((resolve) => {
    const c = getStatsClient();
    // xray pattern is substring match, not glob — 'user>>>' matches all user stat names
    c.QueryStats({ pattern: 'user>>>', reset: true }, (err, response) => {
      if (err || !response?.stat?.length) {
        consecutiveFailures++;
        if (consecutiveFailures === 3) {
          console.warn('[collector] xray Stats API unreachable');
        }
        // Drop the dead client so next call creates a fresh connection
        resetStatsClient();
        resolve();
        return;
      }

      consecutiveFailures = 0;

      const userMap = new Map<string, { upload: number; download: number }>();

      for (const stat of response.stat) {
        const parts = stat.name.split('>>>');
        if (parts.length < 4) continue;
        const username = parts[1];
        const val = parseInt(stat.value || '0', 10) || 0;
        if (val === 0) continue;

        if (!userMap.has(username)) userMap.set(username, { upload: 0, download: 0 });
        const entry = userMap.get(username)!;
        if (stat.name.includes('uplink')) entry.upload += val;
        if (stat.name.includes('downlink')) entry.download += val;
      }

      const entries: { xrayUsername: string; upload: number; download: number }[] = [];
      for (const [xrayUsername, { upload, download }] of userMap) {
        if (upload > 0 || download > 0) {
          entries.push({ xrayUsername, upload, download });
        }
      }

      if (entries.length > 0) {
        insertTrafficBatch(entries);
      }

      resolve();
    });
  });
}

const COLLECT_INTERVAL_MS = 60 * 1000; // 1 minute
let intervalId: ReturnType<typeof setInterval> | null = null;

/** Collect and persist traffic immediately — call before restarting xray. */
export function flushTraffic(): Promise<void> {
  return collectAndReset();
}

export function startTrafficCollector(): void {
  collectAndReset().catch((e) => console.error('[collector]', e));

  intervalId = setInterval(() => {
    collectAndReset().catch((e) => console.error('[collector]', e));
  }, COLLECT_INTERVAL_MS);

  console.log('Traffic collector started (every 60s)');
}

export function stopTrafficCollector(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
  collectAndReset().catch((e) => console.error('[collector]', e));
}
