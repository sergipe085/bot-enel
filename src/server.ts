import { app } from './app';
import { logger } from './lib/logger';
import { redisConnection } from './lib/redis';
import { PHONE_CODE_KEY } from './phone-checker';
import { startAllWorkers } from './queues';
import { PHONE_LOCK_KEY } from './queues/phone-access-queue';

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

redisConnection.del(PHONE_CODE_KEY);
redisConnection.del(PHONE_LOCK_KEY);

// Iniciar o servidor HTTP
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});
