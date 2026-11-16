import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function toWslPath(windowsPath) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(windowsPath)
  if (!match) throw new Error(`Cannot convert the workspace path to WSL: ${windowsPath}`)
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`
}

const command = process.platform === 'win32' ? 'wsl.exe' : 'uv'
const args = process.platform === 'win32'
  ? ['-d', 'Ubuntu', '--', 'bash', `${toWslPath(workspaceRoot)}/scripts/dev-api-wsl.sh`]
  : [
      'run',
      '--project',
      'backend',
      'uvicorn',
      'app.main:app',
      '--app-dir',
      'backend',
      '--reload',
      '--reload-dir',
      'backend/app',
      '--host',
      '127.0.0.1',
      '--port',
      '8000',
    ]

const child = spawn(command, args, {
  cwd: workspaceRoot,
  stdio: 'inherit',
  windowsHide: true,
})

child.on('error', (error) => {
  console.error(`Unable to start the API development server: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code) => {
  process.exit(code ?? 1)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
  })
}
