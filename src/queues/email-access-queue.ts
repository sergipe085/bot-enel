import { logger } from '../lib/logger';
import { redisConnection } from '../lib/redis';
import { waitForVerificationCode } from '../email-checker';
import { v4 as uuidv4 } from 'uuid';

// Chave para o lock no Redis
const EMAIL_LOCK_KEY = 'enel:email:lock:new2';

/**
 * Solicita um código de verificação, garantindo acesso exclusivo ao email
 * @param requestId ID único para esta solicitação
 * @returns O código de verificação ou null se não conseguir obter
 */
export async function requestVerificationCode(requestId: string): Promise<string | null> {
  try {
    logger.info(`Request ${requestId} is trying to get verification code`);

    // Verificar se já existe um lock ativo
    const lockExists = await redisConnection.get(EMAIL_LOCK_KEY);

    if (lockExists) {
      logger.warn(`Request ${requestId} cannot get code, another request ${lockExists} already has the lock`);

      // Esperar até que o lock seja liberado, verificando a cada 5 segundos
      let waitAttempts = 0;
      const maxWaitAttempts = 120; // 10 minutos (5s * 120)

      while (waitAttempts < maxWaitAttempts) {
        // Verificar se o lock ainda existe
        const currentLock = await redisConnection.get(EMAIL_LOCK_KEY);
        if (!currentLock) {
          // Lock foi liberado, podemos tentar adquirir
          break;
        }

        logger.info(`Request ${requestId} waiting for lock to be released (attempt ${waitAttempts + 1}/${maxWaitAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar 5 segundos
        waitAttempts++;
      }

      // Se ainda existir um lock após todas as tentativas, falhar
      const finalCheck = await redisConnection.get(EMAIL_LOCK_KEY);
      if (finalCheck) {
        logger.error(`Request ${requestId} timed out waiting for lock to be released`);
        return null;
      }
    }

    // Adquirir o lock
    const lockAcquired = await redisConnection.set(EMAIL_LOCK_KEY, requestId, 'EX', 600, 'NX');
    if (!lockAcquired) {
      logger.error(`Request ${requestId} failed to acquire lock`);
      return null;
    }

    logger.info(`Request ${requestId} acquired email lock and will wait for verification code`);

    try {
      // Esperar pelo código de verificação
      const verificationCode = await waitForVerificationCode(1000 * 60 * 10); // Esperar até 10 minutos

      if (!verificationCode) {
        logger.error(`Request ${requestId} failed to receive verification code within timeout`);
        return null;
      }

      logger.info(`Request ${requestId} received verification code: ${verificationCode}`);
      return verificationCode;

    } catch (error) {
      logger.error(`Error in request ${requestId} while waiting for verification code:`, error);
      return null;
    }
  } catch (error) {
    logger.error(`Error requesting verification code for ${requestId}:`, error);
    return null;
  }
}

/**
 * Libera o acesso ao email, permitindo que outras solicitações possam obter códigos
 * @param requestId ID da solicitação que possui o lock
 * @returns true se o lock foi liberado com sucesso, false caso contrário
 */
export async function releaseEmailAccess(requestId: string): Promise<boolean> {
  try {
    logger.info(`Request ${requestId} releasing email lock`);

    // Verificar se este requestId possui o lock
    const currentLock = await redisConnection.get(EMAIL_LOCK_KEY);

    if (currentLock === requestId) {
      // Este requestId possui o lock, pode liberá-lo
      await redisConnection.del(EMAIL_LOCK_KEY);
      logger.info(`Request ${requestId} released email lock`);
      return true;
    } else if (currentLock) {
      // Outro requestId possui o lock
      logger.warn(`Request ${requestId} attempted to release lock held by ${currentLock}`);
      return false;
    } else {
      // Lock não existe, talvez já tenha expirado
      logger.info(`Request ${requestId} attempted to release a non-existent lock`);
      return true;
    }
  } catch (error) {
    logger.error(`Error releasing email lock for ${requestId}:`, error);
    return false;
  }
}

/**
 * Verifica se o lock do email está disponível
 * @returns true se o lock está disponível, false caso contrário
 */
export async function checkEmailLockAvailability(): Promise<boolean> {
  try {
    const lockExists = await redisConnection.get(EMAIL_LOCK_KEY);
    return !lockExists;
  } catch (error) {
    logger.error(`Error checking email lock availability:`, error);
    return false;
  }
}

/**
 * Adquire o lock do email
 * @param requestId ID da solicitação
 * @param waitForLock Se true, aguarda até que o lock esteja disponível
 * @returns true se o lock foi adquirido com sucesso, false caso contrário
 */
export async function acquireEmailLock(requestId: string, waitForLock: boolean = false): Promise<boolean> {
  try {
    // Verificar se já existe um lock ativo
    const lockExists = await redisConnection.get(EMAIL_LOCK_KEY);

    if (lockExists) {
      if (!waitForLock) {
        logger.warn(`Request ${requestId} cannot acquire lock, it's held by ${lockExists}`);
        return false;
      }

      logger.info(`Request ${requestId} waiting for lock to be released from ${lockExists}`);

      // Esperar até que o lock seja liberado, verificando a cada 5 segundos
      let waitAttempts = 0;
      const maxWaitAttempts = 120; // 10 minutos (5s * 120)

      while (true) {
        // Verificar se o lock ainda existe
        const currentLock = await redisConnection.get(EMAIL_LOCK_KEY);
        if (!currentLock) {
          // Lock foi liberado, podemos tentar adquirir
          break;
        }

        logger.info(`Request ${requestId} waiting for lock to be released (attempt ${waitAttempts + 1}/${maxWaitAttempts})`);
        await new Promise(resolve => setTimeout(resolve, 10000)); // Esperar 10 segundos
        waitAttempts++;
      }

      // Se ainda existir um lock após todas as tentativas, falhar
      const finalCheck = await redisConnection.get(EMAIL_LOCK_KEY);
      if (finalCheck) {
        logger.error(`Request ${requestId} timed out waiting for lock to be released`);
        return false;
      }
    }

    // Adquirir o lock
    const lockAcquired = await redisConnection.set(EMAIL_LOCK_KEY, requestId, 'EX', 600, 'NX');
    if (!lockAcquired) {
      logger.error(`Request ${requestId} failed to acquire lock`);
      return false;
    }

    logger.info(`Request ${requestId} acquired email lock`);
    return true;
  } catch (error) {
    logger.error(`Error acquiring email lock for ${requestId}:`, error);
    return false;
  }
}
