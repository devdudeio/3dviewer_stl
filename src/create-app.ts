import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

/**
 * Builds the configured application. Shared by the HTTP entry point and by
 * scripts/build-static.mjs, so the prerendered page is byte-for-byte what the
 * server would have rendered.
 */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const projectRoot = join(__dirname, '..');
  app.setBaseViewsDir(join(projectRoot, 'views'));
  app.setViewEngine('hbs');
  return app;
}
