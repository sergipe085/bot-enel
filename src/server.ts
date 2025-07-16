import { app } from './app';
import { logger } from './lib/logger';
import { redisConnection } from './lib/redis';
import { PHONE_CODE_KEY } from './phone-checker';
import { startAllWorkers } from './queues';
import { PHONE_LOCK_KEY } from './queues/phone-access-queue';

const PORT = process.env.PORT || 3006;

async function main() {

  await redisConnection.flushdb();

  await redisConnection.del(PHONE_CODE_KEY);
  await redisConnection.del(PHONE_LOCK_KEY);

  // Iniciar os workers das filas
  await startAllWorkers();

  // Iniciar o servidor HTTP
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

main();