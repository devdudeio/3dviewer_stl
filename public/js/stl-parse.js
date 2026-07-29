/**
 * Binary-STL reader shared by the browser worker and the build script.
 *
 * three's STLLoader cannot serve either caller: in a worker it would need the
 * bare specifier "three" (import maps are document-scoped), and in Node it
 * would pull the whole renderer in. Binary STL is a trivial format, so this
 * reads it directly and returns plain typed arrays.
 *
 * The bounding box is accumulated during the single pass we already make over
 * every vertex — computing it afterwards costs a further ~300 ms in the browser.
 *
 * @param {ArrayBuffer} buffer
 * @returns {{position: Float32Array, normal: Float32Array, min: number[], max: number[], triangles: number}}
 */
export function parseBinaryStl(buffer) {
  const view = new DataView(buffer);
  const triangles = view.getUint32(80, true);

  if (buffer.byteLength !== 84 + triangles * 50) {
    throw new Error('not a binary STL of the expected length');
  }

  const position = new Float32Array(triangles * 9);
  const normal = new Float32Array(triangles * 9);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  let offset = 84;
  let i = 0;
  for (let tri = 0; tri < triangles; tri++) {
    const nx = view.getFloat32(offset, true);
    const ny = view.getFloat32(offset + 4, true);
    const nz = view.getFloat32(offset + 8, true);
    offset += 12;

    for (let vertex = 0; vertex < 3; vertex++) {
      const x = view.getFloat32(offset, true);
      const y = view.getFloat32(offset + 4, true);
      const z = view.getFloat32(offset + 8, true);
      position[i] = x;
      position[i + 1] = y;
      position[i + 2] = z;
      normal[i] = nx;
      normal[i + 1] = ny;
      normal[i + 2] = nz;
      if (x < min[0]) min[0] = x;
      if (y < min[1]) min[1] = y;
      if (z < min[2]) min[2] = z;
      if (x > max[0]) max[0] = x;
      if (y > max[1]) max[1] = y;
      if (z > max[2]) max[2] = z;
      i += 3;
      offset += 12;
    }

    offset += 2; // per-triangle attribute byte count, unused
  }

  return { position, normal, min, max, triangles };
}

/** True for a binary STL whose triangle count matches its byte length. */
export function isBinaryStl(buffer) {
  if (buffer.byteLength < 84) return false;
  const header = new Uint8Array(buffer, 0, 5);
  if (String.fromCharCode(...header).toLowerCase() === 'solid') return false;
  return buffer.byteLength === 84 + new DataView(buffer).getUint32(80, true) * 50;
}
