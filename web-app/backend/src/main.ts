import './register-workspace-aliases';
import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load env variables from root or backend package root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'web-app/backend/.env') });

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  // Global API prefix
  app.setGlobalPrefix('api');

  // After the prefix, so documented paths match the ones actually served.
  const docsPath = setupSwagger(app);

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  console.log(`[Bootstrap] Backend running at: http://localhost:${port}/api`);
  if (docsPath) {
    console.log(`[Bootstrap] API docs at:        http://localhost:${port}/${docsPath}`);
  }
}

bootstrap();
