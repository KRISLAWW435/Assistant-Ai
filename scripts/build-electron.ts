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

  // Ensure build/ folder with icons is present and populated
  const buildDir = path.join(rootDir, 'build');
  const iconIcoPath = path.join(buildDir, 'icon.ico');
  const iconPngPath = path.join(buildDir, 'icon.png');

  if (!fs.existsSync(iconIcoPath) || !fs.existsSync(iconPngPath)) {
    console.log('[BuildElectron] build/ icons not found. Generating default icons...');
    const { writeDefaultIcons } = await import('./generate-icon.ts');
    writeDefaultIcons(buildDir);
  }

  // Sync icons to dist-electron/build and dist/ (if exists) so relative lookups always succeed
  const distElectronBuildDir = path.join(outDir, 'build');
  if (!fs.existsSync(distElectronBuildDir)) {
    fs.mkdirSync(distElectronBuildDir, { recursive: true });
  }
  if (fs.existsSync(iconIcoPath)) {
    fs.copyFileSync(iconIcoPath, path.join(distElectronBuildDir, 'icon.ico'));
  }
  if (fs.existsSync(iconPngPath)) {
    fs.copyFileSync(iconPngPath, path.join(distElectronBuildDir, 'icon.png'));
  }

  const distDir = path.join(rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    const distBuildDir = path.join(distDir, 'build');
    if (!fs.existsSync(distBuildDir)) {
      fs.mkdirSync(distBuildDir, { recursive: true });
    }
    if (fs.existsSync(iconIcoPath)) {
      fs.copyFileSync(iconIcoPath, path.join(distBuildDir, 'icon.ico'));
    }
    if (fs.existsSync(iconPngPath)) {
      fs.copyFileSync(iconPngPath, path.join(distBuildDir, 'icon.png'));
    }
  }

  console.log('[BuildElectron] Verified build/ icons and synced to dist-electron/build');
  console.log('[BuildElectron] Successfully built Electron artifacts in dist-electron/');
}

buildElectron().catch((err) => {
  console.error('[BuildElectron Fatal Error]', err);
  process.exit(1);
});