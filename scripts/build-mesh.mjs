/**
 * Converts the cached NIH 3D STL into a compressed GLB for static hosting.
 *
 * The 91 MB STL cannot be served from a Vercel Function (4.5 MB response cap)
 * and cannot be fetched cross-origin from 3d.nih.gov (no CORS headers), so the
 * deployable artifact is a meshopt-compressed GLB committed to the repo.
 *
 *   node scripts/build-mesh.mjs [--ratio 0.25] [--out public/models]
 *
 * --ratio  fraction of triangles to keep (1 = no simplification)
 *
 * Run `npm run build` first: this reuses the compiled ModelService so the
 * download and its validation are not duplicated here.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression } from '@gltf-transform/extensions';
import { meshopt, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

import { parseBinaryStl } from '../public/js/stl-parse.js';

/**
 * Area-weighted smooth normals for an indexed primitive.
 *
 * gltf-transform's normals() transform cannot be used here: it un-indexes the
 * primitive to write per-face normals, undoing the weld and defeating meshopt.
 */
function addSmoothNormals(document) {
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION').getArray();
      const indices = primitive.getIndices().getArray();
      const normal = new Float32Array(position.length);

      for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i] * 3;
        const b = indices[i + 1] * 3;
        const c = indices[i + 2] * 3;

        const abx = position[b] - position[a];
        const aby = position[b + 1] - position[a + 1];
        const abz = position[b + 2] - position[a + 2];
        const acx = position[c] - position[a];
        const acy = position[c + 1] - position[a + 1];
        const acz = position[c + 2] - position[a + 2];

        // Unnormalised cross product, so larger triangles weigh more.
        const nx = aby * acz - abz * acy;
        const ny = abz * acx - abx * acz;
        const nz = abx * acy - aby * acx;

        for (const v of [a, b, c]) {
          normal[v] += nx;
          normal[v + 1] += ny;
          normal[v + 2] += nz;
        }
      }

      for (let i = 0; i < normal.length; i += 3) {
        const length = Math.hypot(normal[i], normal[i + 1], normal[i + 2]) || 1;
        normal[i] /= length;
        normal[i + 1] /= length;
        normal[i + 2] /= length;
      }

      primitive.setAttribute(
        'NORMAL',
        document
          .createAccessor('NORMAL')
          .setType('VEC3')
          .setArray(normal)
          .setBuffer(document.getRoot().listBuffers()[0]),
      );
    }
  }
}

const args = process.argv.slice(2);
const readArg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};

const ratio = Number(readArg('ratio', '1'));
const outDir = readArg('out', join(process.cwd(), 'public', 'models'));

const { ModelService } = await import('../dist/model/model.service.js');
const { TOOTH_MODEL } = await import('../dist/model/model.constants.js');

const service = new ModelService(join(process.cwd(), '.cache', 'models'));
const cached = await service.getMesh();
console.log(`source: ${basename(cached.path)} (${(cached.bytes / 1e6).toFixed(1)} MB)`);

const stl = await readFile(cached.path);
const { position, normal, triangles } = parseBinaryStl(
  stl.buffer.slice(stl.byteOffset, stl.byteOffset + stl.byteLength),
);
console.log(`parsed: ${triangles.toLocaleString('en-US')} triangles`);

const document = new Document();
const buffer = document.createBuffer();
const primitive = document
  .createPrimitive()
  .setAttribute(
    'POSITION',
    document.createAccessor('POSITION').setType('VEC3').setArray(position).setBuffer(buffer),
  )
  .setAttribute(
    'NORMAL',
    document.createAccessor('NORMAL').setType('VEC3').setArray(normal).setBuffer(buffer),
  )
  .setMaterial(document.createMaterial('cast').setRoughnessFactor(0.42).setMetallicFactor(0.02));

const mesh = document.createMesh(TOOTH_MODEL.id).addPrimitive(primitive);
document
  .createScene()
  .addChild(document.createNode(TOOTH_MODEL.id).setMesh(mesh));
document
  .getRoot()
  .getAsset().generator = `${TOOTH_MODEL.id} build-mesh (source: ${TOOTH_MODEL.entryUrl})`;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;

const transforms = [
  // The STL stores three unshared vertices per triangle, each carrying a flat
  // face normal. Dropping the normals lets weld() merge by position alone
  // (5.7M -> ~1M vertices), which is where most of the size reduction comes
  // from. Smooth normals are rebuilt afterwards.
  (doc) =>
    doc
      .getRoot()
      .listMeshes()
      .forEach((m) => m.listPrimitives().forEach((p) => p.setAttribute('NORMAL', null))),
  weld(),
];

if (ratio < 1) {
  transforms.push(simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.0005 }));
}

await document.transform(...transforms);
addSmoothNormals(document);
await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));
document.createExtension(EXTMeshoptCompression).setRequired(true);

const finalPrimitive = document.getRoot().listMeshes()[0].listPrimitives()[0];
const finalTriangles = finalPrimitive.getIndices().getCount() / 3;
const finalVertices = finalPrimitive.getAttribute('POSITION').getCount();

const glb = await new NodeIO()
  .registerExtensions([EXTMeshoptCompression])
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
  .writeBinary(document);

// Content-hashed name so the deployed file can be cached immutably.
const hash = createHash('sha256').update(glb).digest('hex').slice(0, 8);
const name = `${TOOTH_MODEL.id}.${hash}.glb`;
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, name), glb);
await writeFile(
  join(outDir, `${TOOTH_MODEL.id}.json`),
  `${JSON.stringify(
    {
      file: name,
      bytes: glb.byteLength,
      triangles: finalTriangles,
      vertices: finalVertices,
      simplifyRatio: ratio,
      source: TOOTH_MODEL.entryUrl,
      license: TOOTH_MODEL.license,
      author: TOOTH_MODEL.author,
    },
    null,
    2,
  )}\n`,
);

console.log(
  `wrote ${name}: ${(glb.byteLength / 1e6).toFixed(2)} MB, ` +
    `${finalTriangles.toLocaleString('en-US')} triangles, ` +
    `${finalVertices.toLocaleString('en-US')} vertices ` +
    `(${(cached.bytes / glb.byteLength).toFixed(0)}x smaller than the STL)`,
);
