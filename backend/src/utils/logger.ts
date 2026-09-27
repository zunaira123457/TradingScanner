import pino from 'pino';
import { config } from '@/config/environment';

const isDev = config.isDevelopment;

const logger = pino(
  {
    level: config.logLevel || 'info',
    transport: isDev
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            singleLine: false,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
  }
);

export default logger;
