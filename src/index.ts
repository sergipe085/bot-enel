import pupeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import randomUseragent from "random-useragent";
import { Solver } from "2captcha-ts";
import { Page } from "puppeteer";
import { RetriablePromise } from "./promise";
import * as path from 'path';
import * as fs from 'fs';
import { app } from './app';
import { logger } from './lib/logger';
import { startAllWorkers } from './queues';

const PORT = process.env.PORT || 3000;

// Constants
const CAPTCHA_API_KEY = 'ca7f179fa037be3fd8d1587eaf57939e';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.75 Safari/537.36';
const LOGIN_URL = 'https://www.enel.com.br/pt-ceara/login.html?commonAuthCallerPath=%2Fsamlsso&forceAuth=false&passiveAuth=false&spEntityID=ENEL_CEA_WEB_BRA&tenantDomain=carbon.super&sessionDataKey=b0a15d84-c2fe-40ab-af2b-cd8894ed0c11&relyingParty=ENEL_CEA_WEB_BRA&type=samlsso&sp=ENEL_CEA_WEB_BRA&isSaaSApp=false&authenticators=FacebookAuthenticator%3Afacebook%3BGoogleOIDCAuthenticator%3Agoogle%3BOpenIDConnectAuthenticator%3Aapple_eebrcea%3BEnelCustomBasicAuthenticator%3ALOCAL#';
const EMAIL = 'Comerciallugaenergy@gmail.com';
const PASSWORD = 'Bitu1707*';

// Initialize 2captcha solver
const solver = new Solver(CAPTCHA_API_KEY);

// Setup puppeteer with plugins
pupeteer.use(Stealth());
pupeteer.use(
    RecaptchaPlugin({
        provider: {
            id: '2captcha',
            token: CAPTCHA_API_KEY
        },
        visualFeedback: true
    })
);

logger.info("Puppeteer setup complete");

// Setup download directory
const downloadPath = path.resolve(__dirname, 'downloads');
if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath);
    logger.info(`Created download directory at: ${downloadPath}`);
}

// Type definitions
type ExtractInvoiceParams = {
    login: string;
    senha: string;
    codigoCliente: string;
    mesReferencia: string
};

type InvoiceResult = {
    barCode: string;
    pdf: string;
};

/**
 * Extracts invoice information for a specific customer and reference month
 * @param {ExtractInvoiceParams} params - The extraction parameters
 * @returns {Promise<InvoiceResult>} The invoice data
 */
export async function extractInvoice({ codigoCliente, mesReferencia }: ExtractInvoiceParams): Promise<InvoiceResult> {
    logger.info(`Starting invoice extraction for client: ${codigoCliente}, month: ${mesReferencia}`);

    return new Promise((resolve, reject) => {
        pupeteer.launch({
            headless: false,
            args: [`--disable-dev-shm-usage`, `--disable-gpu`]
        }).then(async browser => {
            try {
                logger.info("Browser launched successfully");
                const page = await browser.newPage();

                // Setup download behavior
                const client = await page.createCDPSession();
                await client.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath
                });
                logger.info("Download behavior configured");

                // Navigate to login page
                logger.info("Navigating to login page");
                await page.goto(LOGIN_URL);
                await new Promise((res) => setTimeout(res, 5000));

                // Select ENEL CEARÁ
                logger.info("Selecting ENEL CEARÁ");
                await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    for (const link of links) {
                        if (link.innerText?.includes('ENEL CEARÁ')) {
                            (link as HTMLElement).click();
                        }
                    }
                });

                await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
                await new Promise((res) => setTimeout(res, 5000));

                // Click on "EMPRESAS" link
                logger.info("Clicking on EMPRESAS link");
                await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    for (const link of links) {
                        if (link.innerText?.includes('EMPRESAS')) {
                            (link as HTMLElement).click();
                        }
                    }
                });

                await new Promise((res) => setTimeout(res, 5000));

                // Find login form inputs
                const selectedInputs = await page.$$eval('input', (inputs) => {
                    return inputs
                        .filter(input => input.name === "emailUsuario" || input.name === "pwdCompany")
                        .map(input => ({
                            id: input.id,
                            name: input.name,
                            type: input.type,
                            value: input.value
                        }));
                });

                logger.debug('Found form inputs:', selectedInputs);
                await new Promise((res) => setTimeout(res, 3000));

                // Fill login form
                logger.info("Filling login credentials");
                const emailInput = await page.$(`[name="emailUsuario"]`);
                if (emailInput) {
                    await emailInput.click({ clickCount: 3 });
                    await emailInput.type(EMAIL, { delay: 100 });
                } else {
                    logger.warn("Email input not found");
                }

                await new Promise((res) => setTimeout(res, 1000));

                const passwordInput = await page.$(`[name="pwdCompany"]`);
                if (passwordInput) {
                    await passwordInput.click({ clickCount: 3 });
                    await passwordInput.type(PASSWORD, { delay: 100 });
                } else {
                    logger.warn("Password input not found");
                }

                // Handle reCAPTCHA and login
                logger.info("Handling reCAPTCHA and submitting login");
                await page.evaluate(async () => {
                    const textarea = document.getElementById('g-recaptcha-response-1') as HTMLTextAreaElement;
                    if (textarea) {
                        textarea.value = "solution";
                        textarea.dispatchEvent(new Event('change', { bubbles: true }));
                    }

                    const buttons = Array.from(document.querySelectorAll('button'));
                    for (const button of buttons) {
                        if (button.innerText?.includes('Acessar')) {
                            (button as HTMLElement).click();
                        }
                    }
                });

                // Track API requests and responses
                let savedRequest: {
                    url: string;
                    method: string;
                    postData?: string;
                    headers: Record<string, string>;
                } | null = null;

                // Intercept requests
                page.on('request', async (request) => {
                    if (request.method() === 'POST' && request.url().includes('AccountInfoCommand')) {
                        savedRequest = {
                            url: request.url(),
                            method: request.method(),
                            postData: request.postData(),
                            headers: request.headers(),
                        };
                        logger.debug('Request captured:', savedRequest);
                    }
                });

                // Intercept responses
                page.on('response', async (response) => {
                    const url = response.url();

                    if (url.includes('getBoleta')) {
                        logger.info("Intercepted invoice response");
                        try {
                            const jsonResponse = await response.json();
                            logger.debug('Invoice data:', jsonResponse);

                            resolve({
                                barCode: jsonResponse.barCode,
                                pdf: jsonResponse.urlPdf
                            });
                        } catch (error) {
                            logger.error('Error processing invoice response:', error);
                        }
                    }
                    else if (url.includes("getHistoricalInvoices")) {
                        logger.info("Intercepted historical invoices response");
                        try {
                            const jsonResponse = await response.json();
                            logger.debug('Historical invoices data:', jsonResponse);
                        } catch (error) {
                            logger.error('Error processing historical invoices response:', error);
                        }
                    }
                });

                await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
                await new Promise((res) => setTimeout(res, 5000));

                // Navigate to "Contas" section
                logger.info("Navigating to Contas section");
                await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    for (const link of links) {
                        if (link.innerText?.includes('Contas')) {
                            (link as HTMLElement).click();
                        }
                    }
                });

                await new Promise((res) => setTimeout(res, 12000));

                // Select the correct client code if needed
                logger.info(`Selecting client code: ${codigoCliente}`);
                await page.evaluate((codigoCliente: string) => {
                    const codigoClienteAtualSpan = document.getElementById('clientCodeS');

                    if (codigoClienteAtualSpan) {
                        const codigoClienteAtual = codigoClienteAtualSpan.textContent?.trim();
                        if (codigoClienteAtual == codigoCliente) {
                            console.log("Already on the correct client code");
                        }
                        else {
                            console.log("Incorrect client code, switching");
                            const codigoAchado = document.querySelector(`li[data-target="${codigoCliente}"]`);
                            if (codigoAchado) {
                                (codigoAchado as HTMLElement)?.click();
                            }
                            else {
                                console.log("Client code not found");
                                // reject({
                                //     message: "Client code not found"
                                // });
                            }
                        }
                    }
                    else {
                        console.log("Client code element not found");
                        // reject({
                        //     message: "Client code element not found"
                        // });
                    }
                }, codigoCliente);

                await new Promise((res) => setTimeout(res, 10000));

                // Click on invoice history button
                logger.info("Opening invoice history");
                await page.evaluate(() => {
                    const historicoButton = document.getElementById("action-item-button-second-billing-way");
                    if (historicoButton) {
                        (historicoButton as HTMLElement)?.click()
                    }
                });

                await new Promise((res) => setTimeout(res, 10000));

                // Select invoice by reference month and download
                logger.info(`Selecting invoice for month: ${mesReferencia}`);
                await page.evaluate((mes) => {
                    const rows = document.querySelectorAll('#tableSecondaViaDeFactura tbody tr');
                    let found = false;

                    for (const row of rows) {
                        const refColumn = row.querySelector('td[data-label="Referência"]');
                        const checkbox = row.querySelector('input.secondBillWay__checkbox') as HTMLInputElement;

                        if (refColumn && checkbox) {
                            const refText = refColumn.textContent?.trim();
                            if (refText == mes) {
                                checkbox.click();
                                found = true;
                                break;
                            }
                        }
                    }

                    if (!found) {
                        // reject({
                        //     message: `Invoice for month ${mes} not found`
                        // });
                    }

                    const downloadButton = document.getElementById("pdf");
                    if (downloadButton) {
                        downloadButton.click();
                    } else {
                    }
                }, mesReferencia);

                await new Promise((res) => setTimeout(res, 5000));

                // Take screenshot for debugging
                logger.info("Taking screenshot");
                await page.screenshot({ path: 'response.png', fullPage: true });

                // Note: Browser is intentionally not closed as per original code
                logger.info("Invoice extraction process completed");

            } catch (error) {
                logger.error("Error during invoice extraction:", error);
                reject(error);
                await browser.close();
            }
        }).catch(error => {
            logger.error("Failed to launch browser:", error);
            reject(error);
        });
    });
}