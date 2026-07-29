import { parseBinaryStl } from './stl-parse.js';

/**
 * Parses binary STL off the main thread and transfers the attribute buffers
 * back with zero copies. The main thread keeps three's STLLoader as a fallback
 * for anything this rejects (ASCII STL, or a browser without module workers).
 */
self.onmessage = ({ data }) => {
  try {
    const { position, normal, min, max } = parseBinaryStl(data);
    self.postMessage({ position, normal, min, max }, [position.buffer, normal.buffer]);
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
