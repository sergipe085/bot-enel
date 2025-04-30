import { Queue, Worker, Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { defaultQueueConfig, QUEUE_NAMES } from './queue-config';
import { logger } from '../lib/logger';
import { extractInvoiceSegundaVia } from '../extract-invoice-segunda-via';
import { webhookQueue } from './webhook-queue';
import { decryptBase64PdfWithQpdf } from '../utils';

// Tipos
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

// Fila de extração
export const extractionQueue = new Queue<ExtractionJobData, ExtractionJobResult>(
  QUEUE_NAMES.EXTRACTION,
  defaultQueueConfig
);

// Processador da fila
export const extractionWorker = new Worker<ExtractionJobData, ExtractionJobResult>(
  QUEUE_NAMES.EXTRACTION,
  async (job: Job<ExtractionJobData>): Promise<ExtractionJobResult> => {
    const { id, numeroCliente, cpfCnpj, mesReferencia, webhookUrl } = job.data;

    try {
      logger.info(`Starting extraction job ${id} for client ${numeroCliente}`);

      // Notificar início do processo
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

      const result = await extractInvoiceSegundaVia({
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

      // Não precisamos mais liberar o lock aqui, pois o próprio processo de extração
      // já liberou o lock após usar o código de verificação ou em caso de erro

      // Notificar erro
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

      return {
        id,
        status: 'failed',
        error: error.message || 'Unknown error'
      };
    }
  },
  {
    connection: defaultQueueConfig.connection,
    concurrency: 10,
  }
);

// Método para adicionar um job de extração
export async function addExtractionJob(data: Omit<ExtractionJobData, 'id'>): Promise<string> {
  const id = uuidv4();

  await extractionQueue.add('extract-invoice', {
    id,
    ...data
  }, {
    jobId: id,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 10000
    }
  });

  return id;
}

// Configurar eventos
extractionWorker.on('completed', (job) => {
  logger.info(`Job ${job.id} completed successfully`);
});

extractionWorker.on('failed', (job, error) => {
  logger.error(`Job ${job?.id} failed:`, error);
});

extractionWorker.on('error', (error) => {
  logger.error('Worker error:', error);
});
