import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

async function buildElectron() {
  const rootDir = process.cwd();
  const outDir = path.join(rootDir, 'dist-electron');

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  console.log('[BuildElectron] Bundling electron/main.ts -> dist-electron/main.cjs...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'electron/main.ts')],
    outfile: path.join(outDir, 'main.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: [
      'electron',
      'fsevents',
      'vite',
      '@tailwindcss/vite',
    ],
    sourcemap: false,
    minify: false,
  });

  console.log('[BuildElectron] Bundling electron/preload.ts -> dist-electron/preload.cjs...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'electron/preload.ts')],
    outfile: path.join(outDir, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: false,
    minify: false,
  });

  // --- ДОБАВЛЕННЫЙ БЛОК ДЛЯ FLOW-INJECT ---
  console.log('[BuildElectron] Bundling electron/flow-inject.ts -> dist-electron/flow-inject.cjs...');
  await esbuild.build({
    entryPoints: [path.join(rootDir, 'electron/flow-inject.ts')],
    outfile: path.join(outDir, 'flow-inject.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    external: ['electron'],
    sourcemap: false,
    minify: false,
  });
  // ----------------------------------------

  console.log('[BuildElectron] Successfully built Electron artifacts in dist-electron/');
}

buildElectron().catch((err) => {
  console.error('[BuildElectron Fatal Error]', err);
  process.exit(1);
});