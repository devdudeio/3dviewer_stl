import { Logger } from '@nestjs/common';

import { createApp } from './create-app';

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  new Logger('Bootstrap').log(`Viewer ready on http://localhost:${port}`);
}

void bootstrap();
