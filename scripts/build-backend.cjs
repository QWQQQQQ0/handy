// Bundle backend TypeScript → dist-backend/server.cjs
// Run during build: node scripts/build-backend.cjs

const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/backend/server-entry.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: 'dist-backend/server.cjs',
  format: 'cjs',
  external: ['@tauri-apps/*'],
}).then(() => {
  console.log('[build-backend] dist-backend/server.cjs');
  // Copy alongside the compiled exe
  try {
    require('fs').cpSync('dist-backend', 'src-tauri/target/release/dist-backend', { recursive: true });
    console.log('[build-backend] copied to src-tauri/target/release/dist-backend/');
  } catch { /* fine if target/release doesn't exist yet */ }
}).catch((err) => {
  console.error('[build-backend] FAILED:', err);
  process.exit(1);
});
