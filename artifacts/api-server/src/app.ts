import path from 'path';
import express, { type Express } from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import router from './routes';
import { logger, genReqId } from './shared/lib/logger';

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    // Use our custom correlation ID generator (honors x-correlation-id inbound)
    genReqId,
    // Surface the correlation ID directly under `correlationId` for easier filtering
    customProps: (req) => ({ correlationId: req.id }),
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split('?')[0],
        };
      },
      res(res) {
        return { statusCode: res.statusCode };
      },
    },
  }),
);
app.use(cors({ exposedHeaders: ['x-correlation-id'] }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api', router);

if (process.env.NODE_ENV === 'production') {
  // In production, the Express server serves the compiled React frontend.
  // express.static serves index.html at / automatically (default behaviour),
  // and the catch-all below handles SPA client-side routes like /dashboard,
  // /test-config, etc. — sending them all back to index.html so React Router
  // can resolve them on the client.
  const frontendDist = path.resolve(process.cwd(), '../traffic-forge/dist/public');
  app.use(express.static(frontendDist));
  app.get('/*path', (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  // In dev the frontend is served by Vite on a separate port; the backend
  // root just returns a tiny banner so health probes / accidental hits
  // don't see a confusing 404.
  app.get('/', (_req, res) => {
    res.status(200).type('text/plain').send('TrafficForge API. Frontend runs on http://localhost:5000 in dev.');
  });
}

export default app;
