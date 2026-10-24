import { spawn, execSync } from 'node:child_process'

// Build dedicated test harness into dist-ocr-test with mode demo
execSync('npx vite build --mode demo --config vite.ocr-test.config.ts', { stdio: 'inherit' })

// Preview dist-ocr-test on port 5194
const preview = spawn('npx', ['vite', 'preview', '--outDir', 'dist-ocr-test', '--host', '127.0.0.1', '--port', '5194', '--strictPort'], {
  stdio: 'inherit',
  shell: true,
})

process.on('SIGINT', () => preview.kill())
process.on('SIGTERM', () => preview.kill())
