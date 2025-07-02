import { logger } from './lib/logger';
import { v4 as uuidv4 } from 'uuid';

// Import phone and email verification methods
import { checkPhoneLockAvailability, acquirePhoneLock, releasePhoneAccess } from './queues/phone-access-queue';
import { checkEmailLockAvailability, acquireEmailLock, releaseEmailAccess } from './queues/email-access-queue';
import { waitForPhoneVerificationCode } from './phone-checker';
import { waitForEmailVerificationCode } from './email-checker';
import { ElementHandle, Page } from 'puppeteer';

// Verification method types
export enum VerificationMethod {
    PHONE = 'phone',
    EMAIL = 'email',
    ANY = 'any' // Try both methods
}

// Result of verification code request
export interface VerificationResult {
    code: string | null;
    method: VerificationMethod | null; // Which method was successful
    requestId: string;
    success: boolean;
}

/**
 * Handles verification code acquisition using the specified method
 * @param method The verification method to use (phone, email, or any)
 * @param preferredMethod If method is ANY, try this method first
 * @returns The verification result with code and method used
 */
export async function handleVerificationCode(
    method: VerificationMethod = VerificationMethod.ANY,
    preferredMethod: VerificationMethod = VerificationMethod.PHONE
): Promise<VerificationResult> {
    // Generate a unique request ID
    const requestId = uuidv4();
    logger.info(`Starting verification code request ${requestId} using method: ${method}`);

    // If a specific method is requested, use only that method
    if (method === VerificationMethod.PHONE) {
        return await handlePhoneVerification(requestId);
    } else if (method === VerificationMethod.EMAIL) {
        return await handleEmailVerification(requestId);
    }

    // For ANY method, we'll try both methods based on availability and preference
    return await handleAnyVerificationMethod(requestId, preferredMethod);
}

/**
 * Handles verification using phone method
 */
async function handlePhoneVerification(requestId: string): Promise<VerificationResult> {
    try {
        // Check if phone lock is available
        const isPhoneLockAvailable = await checkPhoneLockAvailability();

        // If lock is not available, wait for it
        if (!isPhoneLockAvailable) {
            logger.info(`Phone lock is not available, waiting for it to be released...`);
            await acquirePhoneLock(requestId, true); // Wait until lock is available
        } else {
            // Acquire lock without waiting
            await acquirePhoneLock(requestId, false);
        }

        // Wait for verification code
        logger.info(`Waiting for phone verification code for request ${requestId}...`);
        const verificationCode = await waitForPhoneVerificationCode();

        // Release the lock
        await releasePhoneAccess(requestId);

        if (verificationCode) {
            logger.info(`Successfully received phone verification code for request ${requestId}`);
            return {
                code: verificationCode,
                method: VerificationMethod.PHONE,
                requestId,
                success: true
            };
        } else {
            logger.warn(`Failed to get phone verification code for request ${requestId}`);
            return {
                code: null,
                method: VerificationMethod.PHONE,
                requestId,
                success: false
            };
        }
    } catch (error) {
        logger.error(`Error in phone verification for request ${requestId}:`, error);
        // Make sure to release the lock in case of error
        await releasePhoneAccess(requestId);
        return {
            code: null,
            method: VerificationMethod.PHONE,
            requestId,
            success: false
        };
    }
}

/**
 * Handles verification using email method
 */
async function handleEmailVerification(requestId: string): Promise<VerificationResult> {
    try {
        // Check if email lock is available
        const isEmailLockAvailable = await checkEmailLockAvailability();

        // If lock is not available, wait for it
        if (!isEmailLockAvailable) {
            logger.info(`Email lock is not available, waiting for it to be released...`);
            await acquireEmailLock(requestId, true); // Wait until lock is available
        } else {
            // Acquire lock without waiting
            await acquireEmailLock(requestId, false);
        }

        // Wait for verification code
        logger.info(`Waiting for email verification code for request ${requestId}...`);
        const verificationCode = await waitForEmailVerificationCode();

        // Release the lock
        await releaseEmailAccess(requestId);

        if (verificationCode) {
            logger.info(`Successfully received email verification code for request ${requestId}`);
            return {
                code: verificationCode,
                method: VerificationMethod.EMAIL,
                requestId,
                success: true
            };
        } else {
            logger.warn(`Failed to get email verification code for request ${requestId}`);
            return {
                code: null,
                method: VerificationMethod.EMAIL,
                requestId,
                success: false
            };
        }
    } catch (error) {
        logger.error(`Error in email verification for request ${requestId}:`, error);
        // Make sure to release the lock in case of error
        await releaseEmailAccess(requestId);
        return {
            code: null,
            method: VerificationMethod.EMAIL,
            requestId,
            success: false
        };
    }
}

/**
 * Tries both verification methods based on availability and preference
 */
async function handleAnyVerificationMethod(
    requestId: string,
    preferredMethod: VerificationMethod
): Promise<VerificationResult> {
    // Check availability of both methods
    const [isPhoneLockAvailable, isEmailLockAvailable] = await Promise.all([
        checkPhoneLockAvailability(),
        checkEmailLockAvailability()
    ]);

    logger.info(`Availability check for request ${requestId}: Phone=${isPhoneLockAvailable}, Email=${isEmailLockAvailable}`);

    // Determine which method to try first based on availability and preference
    let firstMethod: VerificationMethod;
    let secondMethod: VerificationMethod;

    if (preferredMethod === VerificationMethod.PHONE) {
        // If phone is preferred
        if (isPhoneLockAvailable) {
            // Phone is available and preferred, try it first
            firstMethod = VerificationMethod.PHONE;
            secondMethod = VerificationMethod.EMAIL;
        } else if (isEmailLockAvailable) {
            // Phone is not available but email is, try email first
            firstMethod = VerificationMethod.EMAIL;
            secondMethod = VerificationMethod.PHONE;
        } else {
            // Neither is immediately available, stick with preference
            firstMethod = VerificationMethod.PHONE;
            secondMethod = VerificationMethod.EMAIL;
        }
    } else {
        // If email is preferred
        if (isEmailLockAvailable) {
            // Email is available and preferred, try it first
            firstMethod = VerificationMethod.EMAIL;
            secondMethod = VerificationMethod.PHONE;
        } else if (isPhoneLockAvailable) {
            // Email is not available but phone is, try phone first
            firstMethod = VerificationMethod.PHONE;
            secondMethod = VerificationMethod.EMAIL;
        } else {
            // Neither is immediately available, stick with preference
            firstMethod = VerificationMethod.EMAIL;
            secondMethod = VerificationMethod.PHONE;
        }
    }

    // Try first method
    logger.info(`Trying ${firstMethod} verification first for request ${requestId}`);
    let result: VerificationResult;

    if (firstMethod === VerificationMethod.PHONE) {
        result = await handlePhoneVerification(requestId);
    } else {
        result = await handleEmailVerification(requestId);
    }

    // If first method succeeded, return the result
    if (result.success) {
        return result;
    }

    // If first method failed, try the second method
    logger.info(`First method (${firstMethod}) failed, trying ${secondMethod} verification for request ${requestId}`);

    if (secondMethod === VerificationMethod.PHONE) {
        return await handlePhoneVerification(requestId);
    } else {
        return await handleEmailVerification(requestId);
    }
}

/**
 * Helper function to handle the verification code UI interaction
 * @param page Puppeteer page object
 * @param method Verification method to use
 * @param jobId Job ID to use as request ID
 * @param screenshotPath Path to save screenshots
 * @param sessionId Session ID for screenshots
 */
export async function handleVerificationCodeUI(
    page: any,
    method: VerificationMethod = VerificationMethod.ANY,
    jobId: string,
    screenshotPath: string,
    sessionId: string,
    takeScreenshot: (page: any, sessionId: string, name: string, path: string) => Promise<string | void>
): Promise<string | null> {
    try {
        // Find available verification methods on the page
        const phoneInput = await page.$('input[value*="569"]');
        const emailInput = await page.$('input[value^="co"][value*="@gmail.com"]');

        // Verificar a disponibilidade dos locks
        const [isPhoneLockAvailable, isEmailLockAvailable] = await Promise.all([
            checkPhoneLockAvailability(),
            checkEmailLockAvailability()
        ]);

        logger.info(`Disponibilidade dos locks: Telefone=${isPhoneLockAvailable}, Email=${isEmailLockAvailable}`);

        // Determine which method to use based on availability and preference
        let selectedMethod = method;
        let selectedInput: any = null;

        if (method === VerificationMethod.ANY) {
            // Se ambos os métodos estão disponíveis na página
            if (phoneInput && emailInput) {
                // Verificar a disponibilidade dos locks para decidir qual usar
                if (isPhoneLockAvailable) {
                    // Telefone está livre, usar telefone
                    selectedMethod = VerificationMethod.PHONE;
                    selectedInput = phoneInput;
                    logger.info('Usando telefone porque está disponível na página e o lock está livre');
                } else if (isEmailLockAvailable) {
                    // Telefone está bloqueado, mas email está livre
                    selectedMethod = VerificationMethod.EMAIL;
                    selectedInput = emailInput;
                    logger.info('Usando email porque telefone está com lock bloqueado');
                } else {
                    // Ambos estão bloqueados, usar telefone por padrão (vai aguardar o lock)
                    selectedMethod = VerificationMethod.PHONE;
                    selectedInput = phoneInput;
                    logger.info('Ambos os locks estão bloqueados, usando telefone por padrão');
                }
            } else if (phoneInput) {
                selectedMethod = VerificationMethod.PHONE;
                selectedInput = phoneInput;
                logger.info('Usando telefone porque é o único disponível na página');
            } else if (emailInput) {
                selectedMethod = VerificationMethod.EMAIL;
                selectedInput = emailInput;
                logger.info('Usando email porque é o único disponível na página');
            } else {
                throw new Error("Nenhum método de verificação disponível na página");
            }
        } else if (method === VerificationMethod.PHONE) {
            // Usuário solicitou especificamente telefone
            if (phoneInput) {
                selectedInput = phoneInput;
                logger.info('Usando telefone conforme solicitado');
            } else {
                // Telefone foi solicitado mas não está disponível na página
                if (emailInput) {
                    selectedMethod = VerificationMethod.EMAIL;
                    selectedInput = emailInput;
                    logger.info('Telefone foi solicitado mas não está disponível na página, usando email como fallback');
                } else {
                    throw new Error("Método de verificação por telefone solicitado, mas não está disponível na página");
                }
            }
        } else if (method === VerificationMethod.EMAIL) {
            // Usuário solicitou especificamente email
            if (emailInput) {
                selectedInput = emailInput;
                logger.info('Usando email conforme solicitado');
            } else {
                // Email foi solicitado mas não está disponível na página
                if (phoneInput) {
                    selectedMethod = VerificationMethod.PHONE;
                    selectedInput = phoneInput;
                    logger.info('Email foi solicitado mas não está disponível na página, usando telefone como fallback');
                } else {
                    throw new Error("Método de verificação por email solicitado, mas não está disponível na página");
                }
            }
        }

        // Click on the selected input
        if (!selectedInput) {
            throw new Error(`Selected verification method ${selectedMethod} is not available on the page`);
        }

        await selectedInput.click();

        // Get the input ID and extract the number
        const id = await selectedInput.evaluate((el: any) => el.id);
        const match = id.match(/\d+$/);

        if (!match) {
            throw new Error(`Could not extract number from input ID: ${id}`);
        }

        const num = match[0];

        // Select the appropriate radio button based on the method
        let rdSelector: string;
        if (selectedMethod === VerificationMethod.PHONE) {
            rdSelector = `#CONTENT_Formulario_RdTelefone${num}`;
        } else {
            rdSelector = `#CONTENT_Formulario_RdEmail${num}`;
        }

        // Wait for and click the radio button
        await page.waitForSelector(rdSelector);
        const rdInput = await page.$(rdSelector);

        if (!rdInput) {
            throw new Error(`Could not find radio button: ${rdSelector}`);
        }

        await rdInput.click();
        logger.info(`Selected ${selectedMethod} verification method`);

        await new Promise((resolve) => setTimeout(resolve, 1000));
        await takeScreenshot(page, sessionId, '13_depois_de_clicar_no_metodo', screenshotPath);

        // Request verification code
        const codeRequestId = jobId;

        // Primeiro verificamos a disponibilidade do lock para o método selecionado
        let isLockAvailable: boolean;

        if (selectedMethod === VerificationMethod.PHONE) {
            logger.info(`Verificando disponibilidade do lock de telefone antes de solicitar código...`);
            isLockAvailable = await checkPhoneLockAvailability();

            if (!isLockAvailable) {
                logger.info(`Lock de telefone não está disponível, aguardando liberação...`);
                await acquirePhoneLock(codeRequestId, true); // true = aguardar até que o lock esteja disponível
            } else {
                // Adquirir o lock sem esperar
                await acquirePhoneLock(codeRequestId, false);
                logger.info(`Lock de telefone adquirido com sucesso`);
            }
        } else {
            logger.info(`Verificando disponibilidade do lock de email antes de solicitar código...`);
            isLockAvailable = await checkEmailLockAvailability();

            if (!isLockAvailable) {
                logger.info(`Lock de email não está disponível, aguardando liberação...`);
                await acquireEmailLock(codeRequestId, true); // true = aguardar até que o lock esteja disponível
            } else {
                // Adquirir o lock sem esperar
                await acquireEmailLock(codeRequestId, false);
                logger.info(`Lock de email adquirido com sucesso`);
            }
        }

        // Agora que temos o lock, podemos clicar no botão para solicitar o código
        const submitButton = await page.$("#CONTENT_Formulario_EnviarSt2");

        if (submitButton) {
            await submitButton.click();
            logger.info("Clicou no botão de enviar código");
        } else {
            // Se não encontramos o botão, liberar o lock que adquirimos
            if (selectedMethod === VerificationMethod.PHONE) {
                await releasePhoneAccess(codeRequestId);
            } else {
                await releaseEmailAccess(codeRequestId);
            }
            throw new Error("Não foi possível encontrar o botão de enviar código");
        }

        await takeScreenshot(page, sessionId, '14_depois_de_solicitar_codigo', screenshotPath);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await takeScreenshot(page, sessionId, '15_depois_5_segundos', screenshotPath);

        // Click the continue button if available
        const continueButton = await page.$("#CONTENT_Formulario_ContinuarSt3");
        if (continueButton) {
            await continueButton.click();
            logger.info("Clicou no botão continuar");
        }

        await takeScreenshot(page, sessionId, '16_depois_de_clicar_no_continuar', screenshotPath);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await takeScreenshot(page, sessionId, '17_depois_5_segundos', screenshotPath);

        // Agora que já clicamos no botão, podemos aguardar pelo código
        let verificationCode: string | null = null;

        try {
            if (selectedMethod === VerificationMethod.PHONE) {
                logger.info(`Aguardando código de verificação por telefone...`);
                verificationCode = await waitForPhoneVerificationCode();
                // Liberar o lock após receber o código
                await releasePhoneAccess(codeRequestId);
            } else {
                logger.info(`Aguardando código de verificação por email...`);
                verificationCode = await waitForEmailVerificationCode();
                // Liberar o lock após receber o código
                await releaseEmailAccess(codeRequestId);
            }

            if (!verificationCode) {
                logger.error(`Não foi possível obter o código de verificação`);
            } else {
                logger.info(`Código de verificação recebido com sucesso: ${verificationCode}`);
            }
        } catch (error) {
            // Em caso de erro, garantir que o lock seja liberado
            if (selectedMethod === VerificationMethod.PHONE) {
                await releasePhoneAccess(codeRequestId);
            } else {
                await releaseEmailAccess(codeRequestId);
            }
            logger.error(`Erro ao aguardar código de verificação:`, error);
        }


        // Return the verification code
        return verificationCode;
    } catch (error) {
        logger.error(`Error handling verification code UI:`, error);
        return null;
    }
}
