import { logger } from './lib/logger';
import { redisConnection } from './lib/redis';

export function getPhoneCodeKey(requestId: string) {
    return `enel:phone:lock:code:${requestId}`;
}

/**
 * Searches for verification codes in emails
 * @param requestId - ID for this request
 * @returns The verification code if found, null otherwise
 */
export async function getVerificationCodeFromPhone(requestId: string): Promise<string | null> {
    logger.info('Checking phone for verification code...');

    const startTime = Date.now();

    try {
        const maxWaitTimeMs = 60000;

        while (Date.now() - startTime < maxWaitTimeMs) {
            const code = await redisConnection.get(getPhoneCodeKey(requestId));

            console.log({
                code
            })

            if (code && code.length > 2) {
                return code;
            }

            // Wait before checking again
            logger.info('No verification code found, waiting before checking again...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        logger.warn('Timeout reached, no verification code found');
        return null;
    } catch (error) {
        logger.error('Error checking phone:', error);
        return null;
    }
}

/**
 * Waits for a verification code to be received by phone and returns it
 * @param requestId - ID for this request
 * @returns The verification code if found, null otherwise
 */
export async function waitForPhoneVerificationCode(requestId: string): Promise<string | null> {
    logger.info(`Waiting for verification code in phone...`);

    return await getVerificationCodeFromPhone(requestId);
}
