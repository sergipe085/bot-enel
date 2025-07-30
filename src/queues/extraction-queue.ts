import { Queue, Worker, Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { defaultQueueConfig, QUEUE_NAMES } from './queue-config';
import { logger } from '../lib/logger';
import { extractInvoiceSegundaVia } from '../extract-invoice-segunda-via';
import { webhookQueue } from './webhook-queue';
import { decryptBase64PdfWithQpdf } from '../utils';

export type ExtractionJobData = {
  id: string;
  numeroCliente: string;
  cpfCnpj: string;
  mesReferencia: string | string[];
  webhookUrl?: string;
};

export type ExtractionJobResult = {
  id: string;
  status: 'completed' | 'failed';
  pdfs?: {
    base64Content: string;
    mesReferencia: string;
  }[];
  error?: string;
};

export const extractionQueue = new Queue<ExtractionJobData, ExtractionJobResult>(
  QUEUE_NAMES.EXTRACTION,
  defaultQueueConfig
);

export function setupExtractionWorker() {
  const extractionWorker = new Worker<ExtractionJobData, ExtractionJobResult>(
    QUEUE_NAMES.EXTRACTION,
    async (job: Job<ExtractionJobData>): Promise<ExtractionJobResult> => {
      const { id, numeroCliente, cpfCnpj, mesReferencia, webhookUrl } = job.data;

      try {
        logger.info(`Starting extraction job ${id} for client ${numeroCliente}`);

        if (webhookUrl) {
          await webhookQueue.add('job-started', {
            url: webhookUrl,
            payload: {
              id,
              status: 'started',
              message: `Starting extraction for client ${numeroCliente}`
            }
          });
        }

        await job.updateProgress(20);

        await new Promise(resolve => setTimeout(resolve, job.id ? parseInt(job.id, 36) % 2000 : 1000));

        const result = await extractInvoiceSegundaVia({
          jobId: id,
          webhookUrl,
          numeroCliente,
          cpfCnpj,
          mesReferencia
        });

        await job.updateProgress(90);

        if (webhookUrl) {
          await webhookQueue.add('job-completed', {
            url: webhookUrl,
            payload: {
              id,
              status: 'completed',
              pdfs: await Promise.all(result.pdfs.map(async (pdf) => {
                const primeiros5DigitosCnpj = String(cpfCnpj).replace(/\D/g, '').slice(0, 5);
                const decryptedContent = await decryptBase64PdfWithQpdf(pdf.base64Content, primeiros5DigitosCnpj);
                return {
                  ...pdf,
                  base64Content: decryptedContent
                };
              }))
            }
          });
        }

        logger.info(`Extraction job ${id} completed successfully`);

        return {
          id,
          status: 'completed',
          pdfs: result.pdfs
        };
      } catch (error) {
        logger.error(`Extraction job ${id} failed:`, error);

        if (webhookUrl) {
          await webhookQueue.add('job-failed', {
            url: webhookUrl,
            payload: {
              id,
              status: 'failed',
              error: error.message || 'Unknown error'
            }
          });
        }

        throw error;
      }
    },
    {
      connection: defaultQueueConfig.connection,
      concurrency: 5, // Reduzido para 2 para corresponder ao limite do pool de browsers
      limiter: {
        max: 5, // Limita a 2 jobs por intervalo
        duration: 10000, // Intervalo de 10 segundos
      }
    }
  );

  extractionWorker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed successfully`);
  });

  extractionWorker.on('failed', (job, error) => {
    logger.error(`Job ${job?.id} failed:`, error);
  });

  extractionWorker.on('error', (error) => {
    logger.error('Worker error:', error);
  });
}

export async function addExtractionJob(data: Omit<ExtractionJobData, 'id'>): Promise<string> {
  const id = uuidv4();

  const activeCount = await extractionQueue.getActiveCount();
  const waitingCount = await extractionQueue.getWaitingCount();

  logger.info(`Current queue status: ${activeCount} active jobs, ${waitingCount} waiting jobs`);

  await extractionQueue.add('extract-invoice', {
    id,
    ...data
  }, {
    jobId: id,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000
    },
    // Adiciona um pequeno delay para evitar que múltiplos jobs sejam processados simultaneamente
    delay: Math.floor(Math.random() * 2000) // Delay aleatório de até 2 segundos
  });

  return id;
}

