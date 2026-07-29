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
        // These files are not fingerprinted, so they must revalidate on every
        // load. A far-future max-age here pins clients to a stale viewer.js
        // long after a deploy; ETags make revalidation cheap (304, no body).
        serveStaticOptions: {
          index: false,
          etag: true,
          setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
        },
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
