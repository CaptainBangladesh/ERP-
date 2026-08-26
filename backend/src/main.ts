import './env';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.config';

async function bootstrap(): Promise<void> {
  try {
    const app = await NestFactory.create(AppModule);
    configureApp(app);

    const port = Number(process.env.PORT ?? 3000);
    await app.listen(port, '0.0.0.0');
    // eslint-disable-next-line no-console
    console.log(`API listening on port ${port}`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Fatal error during application startup:', error);
    process.exit(1);
  }
}

void bootstrap();
