import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import { defaultQueueConfig, QUEUE_NAMES } from './queue-config';
import { logger } from '../lib/logger';

// Tipos
export type WebhookJobData = {
  url: string;
  payload: any;
  headers?: Record<string, string>;
};

export type WebhookJobResult = {
  success: boolean;
  statusCode?: number;
  message?: string;
};

// Fila de webhooks
export const webhookQueue = new Queue<WebhookJobData, WebhookJobResult>(
  QUEUE_NAMES.WEBHOOK,
  defaultQueueConfig
);

// Processador da fila
export const webhookWorker = new Worker<WebhookJobData, WebhookJobResult>(
  QUEUE_NAMES.WEBHOOK,
  async (job: Job<WebhookJobData>): Promise<WebhookJobResult> => {
    const { url, payload, headers = {} } = job.data;

    try {
      logger.info(`Sending webhook to ${url}`);

      const requestHeaders = {
        'Content-Type': 'application/json',
        'User-Agent': 'Enel-Bot-Webhook',
        ...headers
      };

      const response = await axios.post(url, payload, {
        headers: requestHeaders,
        timeout: 10000
      });

      logger.info(`Webhook sent successfully to ${url}, status: ${response.status}`);

      return {
        success: true,
        statusCode: response.status,
        message: 'Webhook delivered successfully'
      };
    } catch (error) {
      logger.error(`Failed to send webhook to ${url}:`, error);

      const statusCode = error.response?.status;
      const errorMessage = error.message || 'Unknown error';

      return {
        success: false,
        statusCode: statusCode || 0,
        message: `Failed to deliver webhook: ${errorMessage}`
      };
    }
  },
  {
    connection: defaultQueueConfig.connection,
    concurrency: 100
  }
);

webhookWorker.on('completed', (job) => {
  logger.info(`Webhook job ${job.id} completed`);
});

webhookWorker.on('failed', (job, error) => {
  logger.error(`Webhook job ${job?.id} failed:`, error);
});
