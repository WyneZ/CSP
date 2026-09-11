import { NestFactory } from '@nestjs/core';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Render (and most PaaS reverse proxies) terminate TLS at the edge and
  // forward to this app over plain HTTP, setting X-Forwarded-Proto: https.
  // Without trust proxy, Express sees every request as insecure, so
  // express-session silently refuses to send Set-Cookie when cookie.secure
  // is true (thinking it would be sending a secure cookie over plain HTTP).
  // This must be set before the session middleware below.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // app.enableCors({
  //   origin: [process.env.WEB_ORIGIN ?? 'http://localhost:3000',
  //   credentials: true,
  // });

  app.enableCors({
    origin: [
      'http://localhost:3000',
      'https://csp-web-psi.vercel.app',
    ],
    credentials: true,
  });

  const sessionSecret = process.env.SESSION_SECRET;
  if (!sessionSecret) {
    throw new Error('SESSION_SECRET is not set — check apps/api/.env');
  }

  const PgSession = connectPgSimple(session);

  app.use(
    session({
      store: new PgSession({
        conString: process.env.DATABASE_URL,
        tableName: 'session',
        createTableIfMissing: true,
      }),
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // Vercel (web) and Render (api) are different domains, so the
        // session cookie is cross-site. Cross-site cookies require
        // SameSite=None, and browsers require Secure whenever SameSite=None
        // is set. Both prod hosts are HTTPS, so this is safe there.
        // Locally, api and web share the "site" (localhost), so we keep the
        // default Lax/insecure cookie — Secure would break it over http.
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 1000 * 60 * 60 * 8,
      },
    }),
  );

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
