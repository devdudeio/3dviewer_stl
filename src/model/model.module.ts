import { join } from 'node:path';

import { Module } from '@nestjs/common';

import { MODEL_CACHE_DIR, PREBUILT_MESH_DIR } from './model.constants';
import { ModelController } from './model.controller';
import { ModelService } from './model.service';

@Module({
  controllers: [ModelController],
  providers: [
    {
      provide: MODEL_CACHE_DIR,
      useValue: process.env.MODEL_CACHE_DIR ?? join(process.cwd(), '.cache', 'models'),
    },
    {
      provide: PREBUILT_MESH_DIR,
      useValue: join(__dirname, '..', '..', 'public', 'models'),
    },
    ModelService,
  ],
  exports: [ModelService],
})
export class ModelModule {}
