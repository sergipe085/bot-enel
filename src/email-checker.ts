import { ImapSimple, connect } from 'imap-simple';
import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './lib/logger';

// Email configuration
const EMAIL_CONFIG = {
    user: 'Comerciallugaenergy@gmail.com',
    password: "laej agsb dvhw zhbp",
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    authTimeout: 30000,
    tlsOptions: { rejectUnauthorized: false }
};

/**
 * Searches for verification codes in emails
 * @param searchCriteria - What to search for in the emails
 * @param maxWaitTimeMs - Maximum time to wait for the email in milliseconds
 * @param codeRegex - Regular expression to extract the code from email body
 * @returns The verification code if found, null otherwise
 */
export async function getVerificationCodeFromEmail(
    searchCriteria: string = 'UNSEEN',
    maxWaitTimeMs: number = 60000,
    codeRegex: RegExp = /Seu c&oacute;digo de valida&ccedil;&atilde;o &eacute;:[\s\S]*?<span[^>]*>[\s\S]*?([0-9]+)[\s\S]*?<\/span>/
): Promise<string | null> {
    logger.info('Checking email for verification code...');

    const startTime = Date.now();
    let connection: ImapSimple | null = null;

    try {
        connection = await connect({ imap: EMAIL_CONFIG });
        logger.info('Connected to email server');

        await connection.openBox('INBOX');

        while (Date.now() - startTime < maxWaitTimeMs) {
            const searchOptions = {
                bodies: ['HEADER', 'TEXT', ''],
                markSeen: true
            };

            const messages = await connection.search([searchCriteria], searchOptions);
            logger.info(`Found ${messages.length} messages matching criteria`);

            for (const message of messages.reverse()) {
                const all = message.parts.find(part => part.which === '');
                if (all) {
                    const parsed = await simpleParser(all.body);
                    const subject = parsed.subject || '';
                    const emailHtml = parsed.html || '';

                    // logger.info(`Processing email: ${subject}`);

                    if (subject.includes('ENEL')) {
                        console.log("Found ENEL email");

                        console.log({
                            emailHtml
                        })

                        // Look for verification code in the email html
                        const match = emailHtml.match(codeRegex);
                        if (match && match[1]) {
                            const code = match[1];
                            logger.info(`Found verification code: ${code}`);
                            return code;
                        }
                    }

                }
            }

            // Wait before checking again
            logger.info('No verification code found, waiting before checking again...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }

        logger.warn('Timeout reached, no verification code found');
        return null;
    } catch (error) {
        logger.error('Error checking email:', error);
        return null;
    } finally {
        // Close the connection
        if (connection) {
            try {
                await connection.end();
                logger.info('Email connection closed');
            } catch (error) {
                logger.error('Error closing email connection:', error);
            }
        }
    }
}

/**
 * Waits for a verification code to be received by email and returns it
 * @param timeoutMs - Maximum time to wait for the email in milliseconds
 * @returns The verification code if found, null otherwise
 */
export async function waitForVerificationCode(timeoutMs: number = 120000): Promise<string | null> {
    logger.info(`Waiting for verification code email (timeout: ${timeoutMs}ms)...`);

    // Search for unread emails - use simple UNSEEN criteria
    const searchCriteria = 'UNSEEN';

    return await getVerificationCodeFromEmail(searchCriteria, timeoutMs);
}