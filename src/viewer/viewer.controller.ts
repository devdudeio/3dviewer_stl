import { Controller, Get, Header, Render } from '@nestjs/common';

import { ModelService } from '../model/model.service';

@Controller()
export class ViewerController {
  constructor(private readonly models: ModelService) {}

  @Get()
  @Header('Cache-Control', 'no-cache')
  @Render('viewer')
  viewer() {
    const m = this.models.descriptor;
    return {
      title: m.title,
      author: m.author,
      license: m.license,
      licenseUrl: m.licenseUrl,
      entryUrl: m.entryUrl,
      units: m.units,
      upAxis: m.upAxis,
      triangles: m.triangles.toLocaleString('en-US'),
      trianglesRaw: m.triangles,
      megabytes: (m.expectedBytes / 1024 / 1024).toFixed(0),
      meshUrl: `/api/model/${m.id}.stl`,
    };
  }
}
