import { setupExtractionWorker } from './extraction-queue';
import { setupWebhookWorker } from './webhook-queue';
import { logger } from '../lib/logger';


// Função para iniciar todos os workers
export async function startAllWorkers() {
  try {
    logger.info('Starting all queue workers...');

    // Garantir que os workers estão ativos
    await Promise.all([
      setupExtractionWorker(),
      setupWebhookWorker()
    ]);

    logger.info('All queue workers started successfully');

    // Configurar manipuladores de eventos para o processo
    setupGracefulShutdown();

    return true;
  } catch (error) {
    logger.error('Failed to start queue workers:', error);
    return false;
  }
}

// Função para parar todos os workers
export async function stopAllWorkers() {
  try {
    logger.info('Stopping all queue workers...');

    logger.info('All queue workers stopped successfully');
    return true;
  } catch (error) {
    logger.error('Error stopping queue workers:', error);
    return false;
  }
}

// Configurar encerramento gracioso
function setupGracefulShutdown() {
  // Capturar sinais de término
  const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

  signals.forEach(signal => {
    process.once(signal, async () => {
      logger.info(`Received ${signal}, shutting down gracefully...`);

      try {
        await stopAllWorkers();
        logger.info('Graceful shutdown completed');
        process.exit(0);
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        process.exit(1);
      }
    });
  });
}
