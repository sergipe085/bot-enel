import pupeteer from "puppeteer-extra";
import Stealth from "puppeteer-extra-plugin-stealth";
import RecaptchaPlugin from "puppeteer-extra-plugin-recaptcha";
import randomUseragent from "random-useragent";
import { Solver } from "2captcha-ts";
import { Page } from "puppeteer";
import { RetriablePromise } from "./promise";
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './lib/logger';
import { captchaServer } from './captcha-server-with-ngrok';
// Não importamos mais diretamente o waitForVerificationCode, pois agora usamos a fila
import { v4 as uuidv4 } from 'uuid';
import { waitForVerificationCode } from "./email-checker";

// Constants
const CAPTCHA_API_KEY = 'ca7f179fa037be3fd8d1587eaf57939e';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/73.0.3683.75 Safari/537.36';
const LOGIN_URL = 'https://www.eneldistribuicao.com.br/ce/AcessoRapidosegundavia.aspx';
const EMAIL = 'Comerciallugaenergy@gmail.com';
const PASSWORD = 'Bitu1707*';

// Setup puppeteer with plugins
pupeteer.use(Stealth());

logger.info("Puppeteer setup complete");

// Setup download directory
const downloadPath = path.resolve(__dirname, 'downloads');
if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath);
    logger.info(`Created download directory at: ${downloadPath}`);
}

// Type definitions
type ExtractInvoiceParams = {
    numeroCliente: string;
    cpfCnpj: string;
    mesReferencia: string | string[]
};

type PdfResult = {
    base64Content: string;
    mesReferencia: string;
};

type InvoiceResult = {
    barCode: string;
    pdfs: PdfResult[];
};

/**
 * Extracts invoice information for a specific customer and reference month
 * @param {ExtractInvoiceParams} params - The extraction parameters
 * @returns {Promise<InvoiceResult>} The invoice data
 */
export async function extractInvoiceSegundaVia({ numeroCliente, cpfCnpj, mesReferencia }: ExtractInvoiceParams): Promise<InvoiceResult> {
    // Converter mesReferencia para array se for uma string única
    const mesesReferencia = Array.isArray(mesReferencia) ? mesReferencia : [mesReferencia];

    logger.info(`Starting invoice extraction for client: ${numeroCliente}, months: ${mesesReferencia.join(', ')}`);

    // Gerar UUIDs para os nomes dos arquivos
    const fileUuids = mesesReferencia.map(() => uuidv4());
    const pdfFileNames = fileUuids.map(uuid => `${uuid}.pdf`);
    logger.info(`Generated PDF filenames: ${pdfFileNames.join(', ')}`);

    // Start the captcha server if it's not already running
    try {
        await captchaServer.start();
        logger.info("Captcha server started successfully");
    } catch (error) {
        logger.warn("Captcha server may already be running:", error.message);
    }

    return new Promise((resolve, reject) => {
        pupeteer.launch({
            headless: false,
            args: [`--disable-dev-shm-usage`, `--disable-gpu`],
            executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        }).then(async browser => {
            try {
                const page = await browser.newPage();

                const client = await page.createCDPSession();
                await client.send('Page.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath,
                });
                logger.info("Download behavior configured");


                await page.setViewport({ width: 1280, height: 800 });

                await page.goto(
                    "https://www.eneldistribuicao.com.br/ce/AcessoRapidosegundavia.aspx"
                );

                const selectedInputs = await page.$$eval(".form-group", (formGroups) => {
                    return formGroups
                        .map((group) => {
                            const span = group.querySelector("span");
                            const input = group.querySelector("input");

                            if (input && span) {
                                const labelText = span.innerText.trim();

                                if (
                                    labelText.includes("Número do CPF") ||
                                    labelText.includes("Número de Cliente")
                                ) {
                                    return {
                                        id: input.id,
                                        name: input.name,
                                        type: input.type,
                                        value: input.value,
                                    };
                                }
                            }
                            return null;
                        })
                        .filter((input) => input !== null);
                });

                await new Promise((resolve) => setTimeout(resolve, 3000));

                const numeroClientInput = await page.$(`#${selectedInputs[0].id}`);
                if (numeroClientInput) {
                    await numeroClientInput.click({ clickCount: 3 });
                    await numeroClientInput.type(numeroCliente, { delay: 200 });
                }

                await new Promise((resolve) => setTimeout(resolve, 1000));

                const numeroCpfInput = await page.$(`#${selectedInputs[1].id}`);
                if (numeroCpfInput) {
                    await numeroCpfInput.click({ clickCount: 3 });
                    await numeroCpfInput.type(cpfCnpj, { delay: 200 });
                }

                // Handle hCaptcha
                try {
                    let hcaptchaSiteKey = await page.evaluate(() => {
                        const iframe = document.querySelector('iframe[src*="hcaptcha.com"]');
                        if (iframe) {
                            const src = iframe.getAttribute('src');
                            if (src) {
                                const siteKeyMatch = src.match(/sitekey=([^&]+)/);
                                if (siteKeyMatch) return siteKeyMatch[1];
                            }
                        }

                        const hcaptchaDiv = document.querySelector('div[data-sitekey]');
                        if (hcaptchaDiv) {
                            const siteKey = hcaptchaDiv.getAttribute('data-sitekey');
                            if (siteKey) return siteKey;
                        }

                        const scripts = Array.from(document.querySelectorAll('script'));
                        for (const script of scripts) {
                            const content = script.textContent || '';
                            if (content.includes('hcaptcha')) {
                                const siteKeyMatch = content.match(/sitekey['"]?\s*:\s*['"]([^'"]+)/);
                                if (siteKeyMatch) return siteKeyMatch[1];
                            }
                        }

                        return null;
                    });

                    if (!hcaptchaSiteKey) {
                        const url = page.url();
                        const siteKeyMatch = url.match(/sitekey=([^&]+)/);
                        if (siteKeyMatch) {
                            hcaptchaSiteKey = siteKeyMatch[1];
                        } else {
                            // Last resort - try a common test site key
                            hcaptchaSiteKey = '10000000-ffff-ffff-ffff-000000000001';
                            logger.warn('Using fallback hCaptcha site key as none was found on the page');
                        }
                    }

                    if (hcaptchaSiteKey) {
                        logger.info(`Found hCaptcha with site key: ${hcaptchaSiteKey}`);

                        const screenshotPath = path.join(__dirname, '../public/captcha-screenshot.png');
                        await page.screenshot({ path: screenshotPath, fullPage: true });
                        logger.info(`Saved captcha screenshot to ${screenshotPath}`);

                        const publicScreenshotPath = path.join(__dirname, '../public/captcha-screenshot.png');
                        fs.copyFileSync(screenshotPath, publicScreenshotPath);

                        logger.info("Waiting for human to solve captcha...");

                        const captchaServerUrl = 'http://localhost:3000';

                        logger.info(`Please open ${captchaServerUrl}/pending in your browser to solve the captcha`);
                        logger.info(`The site key being used is: ${hcaptchaSiteKey}`);

                        try {
                            const token = await captchaServer.submitCaptcha(
                                hcaptchaSiteKey,
                                page.url()
                            );

                            logger.info("Captcha solved by human! Applying token...");

                            // Apply the token to the page
                            await page.evaluate((token) => {
                                console.log('Applying captcha token:', token);

                                // This sets the h-captcha-response textarea value
                                const textarea = document.querySelector('textarea[name="h-captcha-response"]');
                                if (textarea) {
                                    (textarea as HTMLTextAreaElement).value = token;
                                }

                                // Also try setting it as a hidden input field
                                const hiddenInput = document.querySelector('input[name="h-captcha-response"]');
                                if (hiddenInput) {
                                    (hiddenInput as HTMLInputElement).value = token;
                                }
                            }, token);

                            logger.info("Captcha token applied successfully");
                        } catch (captchaError) {
                            logger.error("Error getting captcha solution:", captchaError);
                        }
                    } else {
                        logger.warn("Could not find hCaptcha site key on the page");
                    }
                } catch (captchaError) {
                    logger.error("Error handling captcha:", captchaError);
                }


                // Finally, click the submit button after CAPTCHA is solved 
                const submitButton = await page.$("#CONTENT_Formulario_Solicitar");
                if (submitButton) {
                    await submitButton.click();
                    logger.info("Clicked submit button");
                }

                await new Promise((resolve) => setTimeout(resolve, 5000));

                await page.waitForSelector("#CONTENT_Formulario_RdEmail2");

                const emailInput = await page.$("#CONTENT_Formulario_RdEmail2");

                if (emailInput) {
                    await emailInput.click();
                }

                // Importamos dinamicamente para evitar dependência circular
                const { checkEmailLockAvailability, acquireEmailLock } = await import('./queues/email-access-queue');

                // Gerar um ID único para este pedido de código
                const codeRequestId = `code-request-${uuidv4()}`;

                // Verificar se o lock do email está disponível antes de clicar no botão
                logger.info(`Checking email lock availability before requesting code...`);
                const isLockAvailable = await checkEmailLockAvailability();

                if (!isLockAvailable) {
                    logger.info(`Email lock is not available, waiting for it to be released...`);
                    await acquireEmailLock(codeRequestId, true); // true = aguardar até que o lock esteja disponível
                }

                // Agora que temos o lock (ou ele já estava disponível), podemos clicar no botão
                const submitEmailCodeButton = await page.$("#CONTENT_Formulario_EnviarSt2");
                if (submitEmailCodeButton) {
                    // Adquirir o lock antes de clicar no botão (se ainda não o fizemos)
                    if (isLockAvailable) {
                        await acquireEmailLock(codeRequestId, false); // false = não aguardar se não estiver disponível
                    }

                    await submitEmailCodeButton.click();
                    logger.info("Clicked submit email code button");
                } else {
                    // Se não encontramos o botão, liberar o lock que adquirimos
                    const { releaseEmailAccess } = await import('./queues/email-access-queue');
                    await releaseEmailAccess(codeRequestId);
                    throw new Error("Could not find submit email code button");
                }

                await new Promise((resolve) => setTimeout(resolve, 5000));

                const continueButton = await page.$("#CONTENT_Formulario_ContinuarSt3");
                if (continueButton) {
                    await continueButton.click();
                    logger.info("Clicked continue button");
                }

                // Solicitar código de verificação diretamente
                logger.info("Waiting for verification code email...");

                // Importamos dinamicamente para evitar dependência circular
                const { releaseEmailAccess } = await import('./queues/email-access-queue');

                // Aguardar pelo código de verificação (já temos o lock)
                const verificationCode = await waitForVerificationCode(1000 * 60 * 10); // Esperar até 10 minutos

                // Preencher o código no formulário
                const verificationCodeInput = await page.$("#CONTENT_Formulario_CodigoSeguranca");
                if (verificationCodeInput && verificationCode) {
                    await verificationCodeInput.click();
                    await verificationCodeInput.type(verificationCode, { delay: 200 });

                    // Liberar o acesso ao email após usar o código
                    await releaseEmailAccess(codeRequestId);
                } else {
                    // Se não conseguiu o código, ainda assim liberar o acesso
                    await releaseEmailAccess(codeRequestId);
                    if (!verificationCode) {
                        throw new Error("Failed to get verification code");
                    }
                }

                const submitCodeButton = await page.$("#CONTENT_Formulario_ProximoSt4");
                if (submitCodeButton) {
                    await submitCodeButton.click();
                    logger.info("Clicked submit code button");
                }

                await new Promise((resolve) => setTimeout(resolve, 15000));

                await page.waitForSelector('#CONTENT_segviarapida_GridViewSegVia tbody tr');


                // Array para armazenar os caminhos dos PDFs baixados
                const downloadedPdfs: string[] = [];

                // Função para baixar um PDF de um mês específico
                const downloadPdfForMonth = async (mes: string, index: number): Promise<string> => {
                    return new Promise(async (resolveMonth, rejectMonth) => {
                        try {
                            // Se não for o primeiro mês, precisamos limpar seleções anteriores
                            if (index > 0) {
                                // Desmarcar todas as checkboxes selecionadas
                                await page.evaluate(() => {
                                    const checkboxes = document.querySelectorAll('#CONTENT_segviarapida_GridViewSegVia input[type="checkbox"]:checked');
                                    checkboxes.forEach((checkbox: any) => checkbox.click());
                                });
                                await new Promise(r => setTimeout(r, 1000));
                            }

                            logger.info(`Selecting invoice for month: ${mes}`);
                            const found = await page.evaluate((mes) => {
                                const rows = document.querySelectorAll('#CONTENT_segviarapida_GridViewSegVia tbody tr');
                                let found = false;

                                for (const row of rows) {
                                    // Pula a linha de cabeçalho e a linha de paginação
                                    if (!row.querySelector('td')) continue;
                                    if (row.classList.contains('enel-pagination')) continue;

                                    // A terceira coluna contém a referência (formato MM/YYYY)
                                    const cells = row.querySelectorAll('td');
                                    if (cells.length < 9) continue;

                                    const refText = cells[2].textContent?.trim();
                                    const checkbox = cells[8].querySelector('input[type="checkbox"]') as HTMLInputElement;

                                    if (refText && checkbox) {
                                        if (refText === mes) {
                                            checkbox.click();
                                            found = true;
                                            break;
                                        }
                                    }
                                }
                                return found;
                            }, mes);

                            if (!found) {
                                logger.warn(`Invoice for month ${mes} not found`);
                                rejectMonth(new Error(`Invoice for month ${mes} not found`));
                                return;
                            }

                            await new Promise(r => setTimeout(r, 5000));

                            const downloadButton = await page.$("#CONTENT_segviarapida_btnSalvarPDF");
                            if (downloadButton) {
                                await downloadButton.click();
                                logger.info(`Clicked download button for month ${mes}`);
                            } else {
                                logger.warn("Download button not found");
                                rejectMonth(new Error("Download button not found"));
                                return;
                            }

                            await new Promise(r => setTimeout(r, 5000));

                            // Nome do arquivo para este mês específico
                            const pdfFileName = pdfFileNames[index];
                            const pdfPath = path.join(downloadPath, pdfFileName);

                            // Verificar se o arquivo existe ou esperar até que seja baixado
                            let attempts = 0;
                            const maxAttempts = 10;

                            const checkFileExists = () => {
                                if (fs.existsSync(pdfPath)) {
                                    logger.info(`Invoice PDF for month ${mes} downloaded successfully: ${pdfPath}`);
                                    resolveMonth(pdfPath);
                                    return;
                                }

                                // Verificar se algum arquivo PDF foi baixado (caso o nome não tenha sido alterado)
                                const files = fs.readdirSync(downloadPath);
                                const pdfFiles = files.filter(file => file.endsWith('.pdf') && !downloadedPdfs.includes(path.join(downloadPath, file)));

                                if (pdfFiles.length > 0) {
                                    // Pegar o arquivo PDF mais recente
                                    const mostRecentPdf = pdfFiles
                                        .map(file => ({ file, mtime: fs.statSync(path.join(downloadPath, file)).mtime }))
                                        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0].file;

                                    const downloadedPath = path.join(downloadPath, mostRecentPdf);
                                    const newPath = path.join(downloadPath, pdfFileName);

                                    // Renomear o arquivo para o nome UUID
                                    if (downloadedPath !== newPath) {
                                        fs.renameSync(downloadedPath, newPath);
                                        logger.info(`Renamed downloaded PDF from ${mostRecentPdf} to ${pdfFileName}`);
                                    }

                                    logger.info(`Invoice PDF for month ${mes} downloaded successfully: ${newPath}`);
                                    resolveMonth(newPath);
                                    return;
                                }

                                attempts++;
                                if (attempts >= maxAttempts) {
                                    logger.warn(`Invoice PDF for month ${mes} not found after maximum attempts`);
                                    rejectMonth(new Error(`Invoice PDF for month ${mes} not found`));
                                    return;
                                }

                                // Esperar e tentar novamente
                                logger.info(`PDF for month ${mes} not found yet, waiting... (attempt ${attempts}/${maxAttempts})`);
                                setTimeout(checkFileExists, 2000);
                            };

                            // Iniciar a verificação do arquivo
                            setTimeout(checkFileExists, 2000);
                        } catch (error) {
                            logger.error(`Error downloading PDF for month ${mes}:`, error);
                            rejectMonth(error);
                        }
                    });
                };

                try {
                    // Baixar PDFs para cada mês sequencialmente
                    for (let i = 0; i < mesesReferencia.length; i++) {
                        const mes = mesesReferencia[i];
                        const pdfPath = await downloadPdfForMonth(mes, i);
                        downloadedPdfs.push(pdfPath);
                        logger.info(`Successfully downloaded PDF ${i + 1}/${mesesReferencia.length} for month ${mes}`);
                    }

                    // Converter os PDFs para base64 antes de retornar
                    const pdfResults: PdfResult[] = [];

                    for (let i = 0; i < downloadedPdfs.length; i++) {
                        const pdfPath = downloadedPdfs[i];
                        const mes = mesesReferencia[i];

                        try {
                            // Ler o arquivo PDF e convertê-lo para base64
                            const pdfBuffer = fs.readFileSync(pdfPath);
                            const base64Content = pdfBuffer.toString('base64');

                            // Adicionar ao array de resultados
                            pdfResults.push({
                                base64Content,
                                mesReferencia: mes
                            });

                            // Remover o arquivo após a conversão
                            fs.unlinkSync(pdfPath);
                            logger.info(`Removed temporary PDF file: ${pdfPath}`);
                        } catch (error) {
                            logger.error(`Error processing PDF file ${pdfPath} for month ${mes}:`, error);
                        }
                    }

                    // Resolver a promise principal com os resultados
                    resolve({
                        barCode: '',
                        pdfs: pdfResults
                    });
                } catch (error) {
                    // Se algum PDF falhar, ainda retornamos os que foram baixados com sucesso
                    if (downloadedPdfs.length > 0) {
                        logger.warn(`Some PDFs failed to download, but returning ${downloadedPdfs.length} successful downloads`);

                        // Converter os PDFs disponíveis para base64
                        const pdfResults: PdfResult[] = [];

                        for (let i = 0; i < downloadedPdfs.length; i++) {
                            const pdfPath = downloadedPdfs[i];
                            // Encontrar o mês correspondente ao índice do PDF baixado
                            const mesIndex = mesesReferencia.findIndex((_, idx) => idx === i);
                            const mes = mesIndex >= 0 ? mesesReferencia[mesIndex] : 'unknown';

                            try {
                                // Ler o arquivo PDF e convertê-lo para base64
                                const pdfBuffer = fs.readFileSync(pdfPath);
                                const base64Content = pdfBuffer.toString('base64');

                                // Adicionar ao array de resultados
                                pdfResults.push({
                                    base64Content,
                                    mesReferencia: mes
                                });

                                // Remover o arquivo após a conversão
                                fs.unlinkSync(pdfPath);
                                logger.info(`Removed temporary PDF file: ${pdfPath}`);
                            } catch (error) {
                                logger.error(`Error processing PDF file ${pdfPath} for month ${mes}:`, error);
                            }
                        }

                        resolve({
                            barCode: '',
                            pdfs: pdfResults
                        });
                    } else {
                        reject(error);
                    }
                }

            } catch (error) {
                logger.error(`Error during extraction:`, error);
                reject(error);
            } finally {
                await browser.close();
                logger.info(`Browser closed`);
            }
        }).catch(error => {
            logger.error("Failed to launch browser:", error);
            reject(error);
        });
    });
}