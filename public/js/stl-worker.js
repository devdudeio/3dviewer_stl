/**
 * Binary-STL parser running off the main thread.
 *
 * three's STLLoader cannot be used here: it imports the bare specifier "three",
 * and import maps are document-scoped, so a worker cannot resolve it. Binary STL
 * is a trivial format, so we read it directly and transfer the attribute buffers
 * back with zero copies. The main thread falls back to STLLoader if this fails.
 */
self.onmessage = ({ data }) => {
  try {
    const view = new DataView(data);
    const triangles = view.getUint32(80, true);

    if (data.byteLength !== 84 + triangles * 50) {
      throw new Error('not a binary STL of the expected length');
    }

    const position = new Float32Array(triangles * 9);
    const normal = new Float32Array(triangles * 9);

    // Accumulated here for free: computing it on the main thread afterwards
    // costs a further ~300 ms of full passes over the vertex data.
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

    self.postMessage({ position, normal, min, max }, [position.buffer, normal.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
