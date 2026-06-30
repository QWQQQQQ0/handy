// Production backend server — starts Agent API middleware on a local port.
// Tauri spawns this on startup: node scripts/server.cjs
// Uses tsx (TypeScript execute) to load the backend without bundling.

const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.BACKEND_PORT || 5174;
const root = path.resolve(__dirname, '..');

const child = spawn('npx', ['tsx', 'src/backend/standalone-server.ts'], {
  cwd: root,
  env: { ...process.env, BACKEND_PORT: String(PORT) },
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  console.log(`[server] backend exited with code ${code}`);
  process.exit(code ?? 0);
});
