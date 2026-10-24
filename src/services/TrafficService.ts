import { getStatsClient, resetStatsClient } from '../api/grpc/client.js'
import { insertTrafficBatch, queryTraffic, queryAllUsersTraffic } from '../api/db/traffic.js'

export type TrafficPeriod = 'hour' | 'day' | 'week' | 'month' | 'year' | 'all';

export interface UserTraffic {
  name: string;
  upload: number;
  download: number;
}

export const PERIOD_LABELS: Record<TrafficPeriod, string> = {
  hour:  '1ч',
  day:   '24ч',
  week:  '7д',
  month: '30д',
  year:  '1г',
  all:   'Всё',
}

const PERIOD_MS: Record<Exclude<TrafficPeriod, 'all'>, number> = {
  hour:  60 * 60 * 1000,
  day:   24 * 60 * 60 * 1000,
  week:  7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year:  365 * 24 * 60 * 60 * 1000,
}

const COLLECT_INTERVAL_MS = 60 * 1000

export class TrafficService {
  readonly PERIOD_LABELS = PERIOD_LABELS

  private intervalId: ReturnType<typeof setInterval> | null = null
  private consecutiveFailures = 0

  // ─── Collection ──────────────────────────────────────────────────────────

  flush(): Promise<void> {
    return this._collect()
  }

  start(): void {
    this._collect().catch((e) => console.error('[collector]', e))
    this.intervalId = setInterval(() => {
      this._collect().catch((e) => console.error('[collector]', e))
    }, COLLECT_INTERVAL_MS)
    console.log('Traffic collector started (every 60s)')
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    this._collect().catch((e) => console.error('[collector]', e))
  }

  private _collect(): Promise<void> {
    return new Promise((resolve) => {
      const c = getStatsClient()
      c.QueryStats({ pattern: 'user>>>', reset: true }, (err, response) => {
        if (err || !response?.stat?.length) {
          this.consecutiveFailures++
          if (this.consecutiveFailures === 3) {
            console.warn('[collector] xray Stats API unreachable')
          }
          resetStatsClient()
          resolve()
          
return
        }

        this.consecutiveFailures = 0
        const userMap = new Map<string, { upload: number; download: number }>()

        for (const stat of response.stat) {
          const parts = stat.name.split('>>>')
          if (parts.length < 4) {continue}
          const username = parts[1]
          const val = parseInt(stat.value || '0', 10) || 0
          if (val === 0) {continue}

          if (!userMap.has(username)) {userMap.set(username, { upload: 0, download: 0 })}
          const entry = userMap.get(username)!
          if (stat.name.includes('uplink'))   {entry.upload   += val}
          if (stat.name.includes('downlink')) {entry.download += val}
        }

        const entries = [...userMap.entries()]
          .filter(([, { upload, download }]) => upload > 0 || download > 0)
          .map(([xrayUsername, { upload, download }]) => ({ xrayUsername, upload, download }))

        if (entries.length > 0) {insertTrafficBatch(entries)}
        resolve()
      })
    })
  }

  // ─── Queries ─────────────────────────────────────────────────────────────

  queryUser(xrayUsername: string, period: TrafficPeriod = 'all'): UserTraffic {
    const record = queryTraffic(xrayUsername, this._sinceMs(period))
    
return { name: xrayUsername, upload: record.upload, download: record.download }
  }

  queryAll(period: TrafficPeriod = 'all'): UserTraffic[] {
    return queryAllUsersTraffic(this._sinceMs(period)).map(r => ({
      name: r.xray_username, upload: r.upload, download: r.download,
    }))
  }

  // ─── Formatting ───────────────────────────────────────────────────────────

  formatBytes(bytes: number): string {
    if (bytes >= 1_073_741_824) {return `${(bytes / 1_073_741_824).toFixed(1)} GB`}
    if (bytes >= 1_048_576)     {return `${(bytes / 1_048_576).toFixed(1)} MB`}
    if (bytes >= 1_024)         {return `${(bytes / 1_024).toFixed(1)} KB`}
    
return `${bytes} B`
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  private _sinceMs(period: TrafficPeriod): number | undefined {
    if (period === 'all') {return undefined}
    const multiplier = period === 'hour' ? 2 : 1
    
return Date.now() - multiplier * PERIOD_MS[period]
  }
}
