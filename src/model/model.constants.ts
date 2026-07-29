/**
 * Descriptor for the single model this app serves.
 *
 * Source: NIH 3D Print Exchange entry 3DPX-003002 — "Upper dental tooth model".
 * The download URL below is the entry's canonical output-file endpoint (binary
 * STL produced by the NIH 3D conversion pipeline); the S3 location advertised in
 * the entry payload is not publicly readable, so we go through the NIH API.
 */
export interface ModelDescriptor {
  /** Stable id used for cache filenames and the public route. */
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly entryUrl: string;
  readonly downloadUrl: string;
  readonly format: 'stl';
  /** Expected byte size of the upstream file, used as a sanity check. */
  readonly expectedBytes: number;
  readonly triangles: number;
  /** Upstream units. NIH 3D print files are millimetres. */
  readonly units: 'mm';
  /**
   * Which file-space axis points "up" for display. STL carries no orientation,
   * so this is a property of the export; the viewer rotates it onto three.js'
   * +Y. This cast is exported base-up, so its display-up is -Y.
   */
  readonly upAxis: 'y' | '-y' | 'z' | '-z';
}

export const TOOTH_MODEL: ModelDescriptor = {
  id: '3dpx-003002',
  title: 'Upper dental tooth model (maxillary teeth with base)',
  author: 'Michael D. Scherer, DMD, MS, FACP',
  license: 'CC0 1.0 (Public Domain Dedication)',
  licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
  entryUrl: 'https://3d.nih.gov/entries/3dpx-003002',
  downloadUrl:
    'https://3d.nih.gov/api/submissions/4342/runs/c4393ceb-f871-4080-81d3-2cda01e35d0c/output-files/91756',
  format: 'stl',
  expectedBytes: 95_131_584,
  triangles: 1_902_630,
  units: 'mm',
  upAxis: '-y',
};

export const MODEL_CACHE_DIR = 'MODEL_CACHE_DIR';
