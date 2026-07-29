import { join } from 'node:path';

import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';

import { ModelModule } from './model/model.module';
import { ViewerController } from './viewer/viewer.controller';

const projectRoot = join(__dirname, '..');

@Module({
  imports: [
    ModelModule,
    ServeStaticModule.forRoot(
      {
        rootPath: join(projectRoot, 'public'),
        serveRoot: '/static',
        serveStaticOptions: { index: false, maxAge: '1h' },
      },
      // three.js ships browser-ready ES modules; serving them straight from
      // node_modules keeps the client bundler-free and CDN-free.
      {
        rootPath: join(projectRoot, 'node_modules', 'three', 'build'),
        serveRoot: '/vendor/three/build',
        serveStaticOptions: { index: false, maxAge: '1d', immutable: true },
      },
      {
        rootPath: join(projectRoot, 'node_modules', 'three', 'examples', 'jsm'),
        serveRoot: '/vendor/three/addons',
        serveStaticOptions: { index: false, maxAge: '1d', immutable: true },
      },
    ),
  ],
  controllers: [ViewerController],
})
export class AppModule {}
