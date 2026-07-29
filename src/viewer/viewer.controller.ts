import { Controller, Get, Header, Render } from '@nestjs/common';

import { ModelService } from '../model/model.service';

@Controller()
export class ViewerController {
  constructor(private readonly models: ModelService) {}

  @Get()
  @Header('Cache-Control', 'no-cache')
  @Render('viewer')
  async viewer() {
    const m = this.models.descriptor;
    const prebuilt = await this.models.getPrebuilt();
    return {
      title: m.title,
      author: m.author,
      license: m.license,
      licenseUrl: m.licenseUrl,
      entryUrl: m.entryUrl,
      units: m.units,
      upAxis: m.upAxis,
      triangles: (prebuilt?.triangles ?? m.triangles).toLocaleString('en-US'),
      trianglesRaw: prebuilt?.triangles ?? m.triangles,
      megabytes: ((prebuilt?.bytes ?? m.expectedBytes) / 1024 / 1024).toFixed(
        prebuilt ? 1 : 0,
      ),
      meshFormat: prebuilt ? 'glb' : 'stl',
      meshFormatLabel: prebuilt ? 'GLB' : 'STL',
      isPrebuilt: Boolean(prebuilt),
      meshUrl: prebuilt ? `/static/models/${prebuilt.file}` : `/api/model/${m.id}.stl`,
    };
  }
}
