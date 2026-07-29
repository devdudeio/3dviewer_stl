import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { ModelService } from './model.service';

@Controller('api/model')
export class ModelController {
  constructor(private readonly models: ModelService) {}

  /** Everything the client needs to label and scale the model. */
  @Get('metadata')
  @Header('Cache-Control', 'public, max-age=3600')
  async metadata() {
    const m = this.models.descriptor;
    const prebuilt = await this.models.getPrebuilt();
    return {
      id: m.id,
      title: m.title,
      author: m.author,
      license: m.license,
      licenseUrl: m.licenseUrl,
      entryUrl: m.entryUrl,
      units: m.units,
      upAxis: m.upAxis,
      source: {
        format: m.format,
        triangles: m.triangles,
        bytes: m.expectedBytes,
        url: `/api/model/${m.id}.stl`,
      },
      // What the page actually loads: the compressed build artefact when it
      // exists, otherwise the raw STL.
      mesh: prebuilt
        ? {
            format: 'glb',
            triangles: prebuilt.triangles,
            bytes: prebuilt.bytes,
            simplifyRatio: prebuilt.simplifyRatio,
            url: `/static/models/${prebuilt.file}`,
          }
        : {
            format: m.format,
            triangles: m.triangles,
            bytes: m.expectedBytes,
            url: `/api/model/${m.id}.stl`,
          },
    };
  }

  /**
   * Streams the cached binary STL. The first request pulls it from NIH 3D, so
   * it can take a while; every later request is served from disk.
   */
  @Get(':id.stl')
  async mesh(@Req() req: Request, @Res() res: Response): Promise<void> {
    const mesh = await this.models.getMesh();

    res.setHeader('Content-Type', 'model/stl');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('ETag', mesh.etag);
    res.setHeader('Vary', 'Accept-Encoding');

    if (req.headers['if-none-match'] === mesh.etag) {
      res.status(304).end();
      return;
    }

    const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');
    const gzipPath = acceptsGzip ? await this.models.getGzippedMesh() : undefined;

    if (gzipPath) {
      const { size } = await stat(gzipPath);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Content-Length', size);
      // Lets the client show a byte-accurate progress bar despite gzip.
      res.setHeader('X-Uncompressed-Length', mesh.bytes);
      createReadStream(gzipPath).pipe(res);
      return;
    }

    res.setHeader('Content-Length', mesh.bytes);
    createReadStream(mesh.path).pipe(res);
  }
}
