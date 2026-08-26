import { INestApplication } from '@nestjs/common';
import { ApiExceptionFilter } from './http/api-exception.filter';

/**
 * Everything that makes the running app behave like the tested app.
 *
 * The test harness calls this too, so a test never exercises a differently-configured
 * application than the one users get. Any global filter, pipe, or interceptor added later
 * belongs here rather than in `main.ts`.
 *
 * No CORS: the frontend reaches the API same-origin, proxied through Vite in development.
 * An origin-reflecting policy would be a decision about credentials made before there are
 * any credentials to protect — ticket 02 introduces sessions, and can decide then.
 */
export function configureApp(app: INestApplication): void {
  const corsOrigin = process.env.CORS_ORIGIN;
  if (corsOrigin) {
    const origin = corsOrigin === '*' ? true : corsOrigin.split(',').map((o) => o.trim());
    app.enableCors({
      origin,
      credentials: true,
    });
  }

  app.useGlobalFilters(new ApiExceptionFilter());
}
