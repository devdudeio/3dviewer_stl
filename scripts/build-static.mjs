/**
 * Prerenders the viewer into a fully static site for CDN hosting (Vercel etc).
 *
 * The page's content is entirely build-time constants, so there is nothing a
 * server needs to do at request time — and a static deploy sidesteps the two
 * limits that block the server design on Vercel: the 4.5 MB Function response
 * cap and the missing CORS headers on 3d.nih.gov.
 *
 * Requires the compressed mesh: run `npm run build:mesh` first.
 */
import { cp, mkdir, rm, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const projectRoot = process.cwd();
const outDir = join(projectRoot, 'out');

/**
 * three.js addons pulled in by the viewer, plus their own relative imports.
 * Copying only these keeps the deployment small; a missing entry shows up
 * immediately as a 404 in the browser console.
 */
const THREE_ADDONS = [
  'controls/OrbitControls.js',
  'environments/RoomEnvironment.js',
  'loaders/GLTFLoader.js',
  'loaders/STLLoader.js',
  'libs/meshopt_decoder.module.js',
  'utils/BufferGeometryUtils.js',
  'utils/SkeletonUtils.js',
];

const { createApp } = await import('../dist/create-app.js');

const models = join(projectRoot, 'public', 'models');
const hasMesh = await readdir(models).then(
  (files) => files.some((f) => f.endsWith('.glb')),
  () => false,
);
if (!hasMesh) {
  console.error('No compressed mesh in public/models — run `npm run build:mesh` first.');
  process.exit(1);
}

const app = await createApp();
await app.listen(0);
const origin = await app.getUrl();
const html = await fetch(`${origin.replace('[::1]', 'localhost')}/`).then((r) => r.text());
await app.close();

if (!html.includes('data-mesh-format="glb"')) {
  console.error('Prerendered page does not point at the GLB; aborting.');
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'index.html'), html);

await cp(join(projectRoot, 'public'), join(outDir, 'static'), { recursive: true });
await cp(
  join(projectRoot, 'node_modules', 'three', 'build', 'three.module.js'),
  join(outDir, 'vendor', 'three', 'build', 'three.module.js'),
);
await cp(
  join(projectRoot, 'node_modules', 'three', 'build', 'three.core.js'),
  join(outDir, 'vendor', 'three', 'build', 'three.core.js'),
);
await cp(
  join(projectRoot, 'node_modules', '@paulmillr', 'qr', 'esm', 'index.js'),
  join(outDir, 'vendor', 'qr', 'index.js'),
);
for (const addon of THREE_ADDONS) {
  await cp(
    join(projectRoot, 'node_modules', 'three', 'examples', 'jsm', addon),
    join(outDir, 'vendor', 'three', 'addons', addon),
  );
}

async function totalSize(dir) {
  let bytes = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    bytes += entry.isDirectory() ? await totalSize(path) : (await stat(path)).size;
  }
  return bytes;
}

console.log(`out/ ready: ${((await totalSize(outDir)) / 1e6).toFixed(1)} MB`);
console.log('deploy with: vercel deploy --prebuilt=false  (or connect the repo in the dashboard)');
