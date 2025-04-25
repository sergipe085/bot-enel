import { QueueOptions } from 'bullmq';
import { redisConnection } from '../lib/redis';

// Configurações padrão para todas as filas
export const defaultQueueConfig: QueueOptions = {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: 100, // Manter apenas os últimos 100 jobs completos
    removeOnFail: 500,     // Manter mais jobs com falha para análise
  },
  // Habilitar eventos para todas as filas
  streams: {
    events: {
      maxLen: 10000
    }
  }
};

// Nomes das filas
export const QUEUE_NAMES = {
  EXTRACTION: 'invoice-extraction',
  EMAIL_ACCESS: 'email-access',
  WEBHOOK: 'webhook-notifications'
};
