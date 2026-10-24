import { spawnSync } from 'child_process'
import { run } from './runner.js'

export function getUserLink(name: string): string {
  return run(['link', name])
}

export function getUserGrpcLink(name: string): string {
  return run(['link_grpc', name])
}

export function getUserQrPath(name: string): string {
  const link = getUserLink(name)
  const tmpFile = `/tmp/xray-qr-${name}-${Date.now()}.png`

  const result = spawnSync('qrencode', ['-o', tmpFile, '-s', '6', link], {
    encoding: 'utf-8',
    timeout: 10000,
  })

  if (result.status !== 0 || result.error) {
    throw new Error('qrencode not found or failed. Install it: apt-get install qrencode')
  }

  return tmpFile
}
