import { app } from './app';
import { logger } from './lib/logger';
import { startAllWorkers } from './queues';

const PORT = process.env.PORT || 3006;

// Iniciar os workers das filas
startAllWorkers()
  .then(success => {
    if (success) {
      logger.info('Queue workers started successfully');
    } else {
      logger.warn('Failed to start some queue workers');
    }
  })
  .catch(error => {
    logger.error('Error starting queue workers:', error);
  });

// Iniciar o servidor HTTP
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
