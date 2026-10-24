import { run, XrayUser } from './runner.js'

export type { XrayUser }

export function listUsers(): XrayUser[] {
  const output = run(['list'])
  const lines = output.split('\n').filter(l => l.trim())
  
return lines.slice(2).map(line => {
    const parts = line.trim().split(/\s+/)
    
return {
      name:     parts[0] || '',
      upload:   parts[1] ? `${parts[1]} ${parts[2] || ''}`.trim() : '0 B',
      download: parts[3] ? `${parts[3]} ${parts[4] || ''}`.trim() : '0 B',
    }
  }).filter(u => u.name)
}

export function addUser(name: string): string {
  const output = run(['add', name])
  const link = output.split('\n').find(l => l.startsWith('vless://'))
  
return link || output
}

export function deleteUser(name: string): void {
  run(['del', name])
}

export function findUserByUuid(uuid: string): string | null {
  try {
    return run(['find-uuid', uuid])
  } catch {
    return null
  }
}
