import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const projectRoot = join(__dirname, '..');
  app.setBaseViewsDir(join(projectRoot, 'views'));
  app.setViewEngine('hbs');

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Viewer ready on http://localhost:${port}`);
}

void bootstrap();
