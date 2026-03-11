import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.enableCors();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  logger.log(`MCP Git Server running on http://localhost:${port}`);
  logger.log(`SSE endpoint:      http://localhost:${port}/mcp/sse`);
  logger.log(`Messages endpoint: http://localhost:${port}/mcp/messages`);
}

bootstrap();
