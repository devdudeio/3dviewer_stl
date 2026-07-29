import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import {
  MODEL_CACHE_DIR,
  ModelDescriptor,
  PREBUILT_MESH_DIR,
  PrebuiltMesh,
  TOOTH_MODEL,
} from './model.constants';

/** What we persist next to the cached mesh so restarts don't re-hash it. */
interface CachedModelMeta {
  bytes: number;
  etag: string;
  fetchedAt: string;
}

export interface CachedModel extends CachedModelMeta {
  path: string;
}

const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Fetches the upstream STL once, stores it under the cache directory and hands
 * out a local path plus a strong ETag. Downloads and gzip compression are
 * de-duplicated, so N concurrent first requests still cause exactly one fetch.
 */
@Injectable()
export class ModelService {
  private readonly logger = new Logger(ModelService.name);
  private readonly model: ModelDescriptor = TOOTH_MODEL;

  private downloadInFlight?: Promise<CachedModel>;
  private gzipInFlight?: Promise<string>;

  private prebuilt?: PrebuiltMesh | null;

  constructor(
    @Inject(MODEL_CACHE_DIR) private readonly cacheDir: string,
    @Inject(PREBUILT_MESH_DIR) private readonly prebuiltDir: string = '',
  ) {}

  get descriptor(): ModelDescriptor {
    return this.model;
  }

  /**
   * The compressed GLB from `npm run build:mesh`, if it has been generated.
   * When present the page loads that instead of the 91 MB STL — it is also the
   * only form that can be hosted statically. Resolved once and remembered.
   */
  async getPrebuilt(): Promise<PrebuiltMesh | undefined> {
    if (this.prebuilt !== undefined) return this.prebuilt ?? undefined;

    try {
      const manifest = await readFile(join(this.prebuiltDir, `${this.model.id}.json`), 'utf8');
      this.prebuilt = JSON.parse(manifest) as PrebuiltMesh;
      this.logger.log(
        `Serving prebuilt mesh ${this.prebuilt.file} (${Math.round(this.prebuilt.bytes / 1024)} KB)`,
      );
    } catch {
      this.prebuilt = null;
      this.logger.log('No prebuilt mesh found; serving the STL from cache');
    }
    return this.prebuilt ?? undefined;
  }

  private get meshPath(): string {
    return join(this.cacheDir, `${this.model.id}.stl`);
  }

  private get metaPath(): string {
    return join(this.cacheDir, `${this.model.id}.json`);
  }

  private get gzipPath(): string {
    return join(this.cacheDir, `${this.model.id}.stl.gz`);
  }

  /** Local STL, downloading it from NIH 3D on first use. */
  async getMesh(): Promise<CachedModel> {
    const cached = await this.readCache();
    if (cached) return cached;

    this.downloadInFlight ??= this.download().finally(() => {
      this.downloadInFlight = undefined;
    });
    return this.downloadInFlight;
  }

  /**
   * Gzip-compressed copy of the mesh (~72 MB vs 91 MB), built lazily on the
   * first request that accepts gzip. Returns undefined if compression fails —
   * callers fall back to the identity-encoded file.
   */
  async getGzippedMesh(): Promise<string | undefined> {
    await this.getMesh();

    this.gzipInFlight ??= this.compress().finally(() => {
      this.gzipInFlight = undefined;
    });

    try {
      return await this.gzipInFlight;
    } catch (error) {
      this.logger.warn(`gzip precompression failed: ${String(error)}`);
      return undefined;
    }
  }

  private async readCache(): Promise<CachedModel | undefined> {
    try {
      const [meshStat, rawMeta] = await Promise.all([
        stat(this.meshPath),
        readFile(this.metaPath, 'utf8'),
      ]);
      const meta = JSON.parse(rawMeta) as CachedModelMeta;
      if (meshStat.size !== meta.bytes) return undefined;
      return { ...meta, path: this.meshPath };
    } catch {
      return undefined;
    }
  }

  private async download(): Promise<CachedModel> {
    const { downloadUrl, expectedBytes } = this.model;
    const tmpPath = `${this.meshPath}.download`;

    await mkdir(this.cacheDir, { recursive: true });
    this.logger.log(`Downloading ${this.model.id} from ${downloadUrl}`);

    try {
      const response = await fetch(downloadUrl, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        headers: { accept: 'application/octet-stream' },
      });
      if (!response.ok || !response.body) {
        throw new Error(`upstream responded ${response.status} ${response.statusText}`);
      }

      const hash = createHash('sha256');
      let bytes = 0;
      const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
      source.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        hash.update(chunk);
      });

      await pipeline(source, createWriteStream(tmpPath));

      if (bytes !== expectedBytes) {
        throw new Error(`expected ${expectedBytes} bytes, received ${bytes}`);
      }
      await this.assertBinaryStl(tmpPath, bytes);

      const meta: CachedModelMeta = {
        bytes,
        etag: `"${hash.digest('hex').slice(0, 32)}"`,
        fetchedAt: new Date().toISOString(),
      };

      await rename(tmpPath, this.meshPath);
      await writeFile(this.metaPath, JSON.stringify(meta, null, 2));
      this.logger.log(`Cached ${this.model.id} (${bytes} bytes) at ${this.meshPath}`);

      return { ...meta, path: this.meshPath };
    } catch (error) {
      await rm(tmpPath, { force: true });
      this.logger.error(`Download of ${this.model.id} failed: ${String(error)}`);
      throw new ServiceUnavailableException(
        'The model could not be retrieved from NIH 3D. Please retry shortly.',
      );
    }
  }

  /** Rejects HTML error pages and truncated files that happen to be the right length. */
  private async assertBinaryStl(path: string, bytes: number): Promise<void> {
    const header = Buffer.alloc(84);
    const handle = await open(path, 'r');
    try {
      await handle.read(header, 0, 84, 0);
    } finally {
      await handle.close();
    }

    if (header.subarray(0, 5).toString('ascii').toLowerCase() === 'solid') {
      throw new Error('expected binary STL, got ASCII STL');
    }
    const triangles = header.readUInt32LE(80);
    if (84 + triangles * 50 !== bytes) {
      throw new Error(`STL triangle count ${triangles} does not match ${bytes} bytes`);
    }
  }

  private async compress(): Promise<string> {
    try {
      const existing = await stat(this.gzipPath);
      if (existing.size > 0) return this.gzipPath;
    } catch {
      // not compressed yet
    }

    const tmpPath = `${this.gzipPath}.tmp`;
    this.logger.log(`Compressing ${this.model.id} for gzip clients`);
    try {
      await pipeline(
        createReadStream(this.meshPath),
        createGzip({ level: 6 }),
        createWriteStream(tmpPath),
      );
      await rename(tmpPath, this.gzipPath);
      return this.gzipPath;
    } catch (error) {
      await rm(tmpPath, { force: true });
      throw error;
    }
  }
}
