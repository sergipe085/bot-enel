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
import { captchaServer } from './captcha-server-new';

// commit

// Função para tirar screenshots organizadas
async function takeScreenshot(page: Page, sessionId: string, step: string, screenshotPath: string): Promise<string> {

    try {
        // Criar pasta para a sessão se não existir
        const sessionDir = path.join(screenshotPath, sessionId);
        if (!fs.existsSync(sessionDir)) {
            fs.mkdirSync(sessionDir, { recursive: true });
        }

        // Formatar timestamp
        const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');

        // Nome do arquivo: step_timestamp.png
        const filename = `${step}_${timestamp}.png`;
        const filepath = path.join(sessionDir, filename);

        // Tirar screenshot
        await page.screenshot({ path: filepath, fullPage: true });

        logger.info(`Screenshot salva: ${filepath}`);
        return filepath;
    }
    catch (err: any) {
        logger.error('Erro ao tirar screenshot:', err);
        return '';
    }
}
// Importamos o centralizador de verificação
import { v4 as uuidv4 } from 'uuid';
import { handleVerificationCodeUI, VerificationMethod } from "./verification-code-handler";
import { webhookQueue } from "./queues/webhook-queue";

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

// Type definitions
type ExtractInvoiceParams = {
    jobId: string;
    webhookUrl?: string;
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
export async function extractInvoiceSegundaVia({ jobId, webhookUrl, numeroCliente, cpfCnpj, mesReferencia }: ExtractInvoiceParams): Promise<InvoiceResult> {
    // Converter mesReferencia para array se for uma string única
    const mesesReferencia = Array.isArray(mesReferencia) ? mesReferencia : [mesReferencia];

    logger.info(`Starting invoice extraction for client: ${numeroCliente}, months: ${mesesReferencia.join(', ')}`);

    // Gerar UUIDs para os nomes dos arquivos
    const fileUuids = mesesReferencia.map(() => uuidv4());
    const pdfFileNames = fileUuids.map(uuid => `${uuid}.pdf`);
    logger.info(`Generated PDF filenames: ${pdfFileNames.join(', ')}`);

    // Gerar um ID de sessão único para esta execução (para organizar screenshots)
    const sessionId = jobId;
    logger.info(`Session ID for screenshots: ${sessionId}`);

    // Caminho para salvar screenshots
    const screenshotPath = path.join(process.cwd(), 'screenshots');
    if (!fs.existsSync(screenshotPath)) {
        fs.mkdirSync(screenshotPath, { recursive: true });
    }

    // Start the captcha server if it's not already running
    try {
        await captchaServer.start();
        logger.info("Captcha server started successfully");
    } catch (error) {
        logger.warn("Captcha server may already be running:", error.message);
    }

    return new Promise((resolve, reject) => {
        // Configuração do Puppeteer para funcionar tanto em ambiente local quanto em Docker
        const isDocker = process.env.RUNNING_IN_DOCKER === 'true';
        // const puppeteerConfig = {
        //     headless: false, // Usando false para ambos os ambientes para evitar detecção de bot
        //     args: [
        //         `--disable-dev-shm-usage`,
        //         `--disable-gpu`,
        //         `--no-sandbox`,
        //         `--disable-setuid-sandbox`,
        //         `--window-size=1280,1024`,
        //         `--start-maximized`,
        //         // Argumentos para tornar o navegador menos detectável como bot
        //         `--disable-blink-features=AutomationControlled`,
        //         // Argumentos adicionais para o ambiente X11 no Docker
        //         isDocker ? `--display=${process.env.DISPLAY || ':99'}` : '',
        //         isDocker ? '--disable-software-rasterizer' : '',
        //         isDocker ? '--disable-dev-shm-usage' : '',
        //         isDocker ? '--disable-extensions' : '',
        //         isDocker ? '--mute-audio' : '',
        //     ].filter(Boolean), // Remove argumentos vazios
        //     executablePath: isDocker
        //         ? '/usr/bin/chromium'
        //         : process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        //     defaultViewport: null, // Desativa o viewport fixo para parecer mais humano
        //     env: isDocker ? {
        //         ...process.env,
        //         DISPLAY: process.env.DISPLAY || ':99',
        //         DBUS_SESSION_BUS_ADDRESS: process.env.DBUS_SESSION_BUS_ADDRESS || 'unix:path=/var/run/dbus/system_bus_socket'
        //     } : undefined,
        //     timeout: 1000 * 60 * 2,
        // };

        const puppeteerConfig = {
            headless: true,
            args: [
                `--disable-dev-shm-usage`,
                `--disable-gpu`,
                `--no-sandbox`,
                `--disable-setuid-sandbox`,
                `--window-size=1280,1024`,
                `--start-maximized`,
                `--disable-blink-features=AutomationControlled`,
                `--disable-software-rasterizer`,
                `--disable-dev-shm-usage`,
                `--disable-extensions`,
                `--mute-audio`,
            ].filter(Boolean),
            executablePath: '/usr/bin/chromium',
            defaultViewport: null,
            env: {
                ...process.env,
            },
            timeout: 1000 * 60 * 2,
        };

        logger.info(`Launching browser with config: ${JSON.stringify(puppeteerConfig)}`);

        pupeteer.launch(puppeteerConfig).then(async browser => {
            try {
                const page = await browser.newPage();

                // Mascarar a automação para evitar detecção como bot
                await page.evaluateOnNewDocument(() => {
                    // Remover a propriedade webdriver
                    Object.defineProperty(navigator, 'webdriver', {
                        get: () => undefined
                    });

                    // Remover outras propriedades que podem identificar automação
                    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
                    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
                    delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;

                    // Modificar o userAgent para parecer mais humano
                    Object.defineProperty(navigator, 'userAgent', {
                        get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                    });

                    // Adicionar plugins falsos para parecer um navegador normal
                    Object.defineProperty(navigator, 'plugins', {
                        get: () => [
                            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
                            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
                            { name: 'Native Client', filename: 'internal-nacl-plugin' }
                        ]
                    });
                });

                const downloadPath = path.resolve(__dirname, 'downloads', sessionId);
                if (!fs.existsSync(downloadPath)) {
                    fs.mkdirSync(downloadPath, { recursive: true });
                    logger.info(`Created download directory at: ${downloadPath}`);
                }


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

                // Screenshot após carregar a página inicial
                await takeScreenshot(page, sessionId, '01_pagina_inicial', screenshotPath);

                // Aguardar até que os elementos do formulário estejam carregados
                logger.info("Aguardando carregamento dos elementos do formulário...");
                await page.waitForSelector('.form-group', { timeout: 30000 })
                    .catch(async error => {
                        // Screenshot em caso de erro
                        await takeScreenshot(page, sessionId, '02_erro_form_timeout', screenshotPath);
                        logger.error(`Timeout ao aguardar elementos do formulário: ${error.message}`);
                        throw new Error("Timeout ao aguardar elementos do formulário");
                    });

                logger.info("Elementos do formulário carregados, buscando inputs...");

                // Screenshot após carregar os elementos do formulário
                await takeScreenshot(page, sessionId, '03_form_carregado', screenshotPath);

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
                                        label: labelText
                                    };
                                }
                            }
                            return null;
                        })
                        .filter((input) => input !== null);
                });

                logger.info(`Inputs encontrados: ${JSON.stringify(selectedInputs)}`);

                // Verificar se encontramos os inputs necessários
                if (!selectedInputs || selectedInputs.length < 2) {
                    logger.error(`Não foi possível encontrar todos os campos necessários. Inputs encontrados: ${JSON.stringify(selectedInputs)}`);

                    // Tirar screenshot para debug
                    await takeScreenshot(page, sessionId, '04_erro_inputs_nao_encontrados', screenshotPath);

                    throw new Error("Não foi possível encontrar os campos de entrada necessários na página");
                }

                // Screenshot antes de preencher os campos
                await takeScreenshot(page, sessionId, '05_antes_preencher_campos', screenshotPath);

                // Aguardar mais um pouco para garantir que os inputs estão interativos
                await new Promise(resolve => setTimeout(resolve, 3000));

                // Verificar se o input do número do cliente existe e tem ID
                if (selectedInputs[0] && selectedInputs[0].id) {
                    const selectorCliente = `#${selectedInputs[0].id}`;

                    // Aguardar até que o elemento seja clicável
                    await page.waitForSelector(selectorCliente, { visible: true, timeout: 10000 })
                        .catch(error => {
                            logger.error(`Timeout ao aguardar input do cliente: ${error.message}`);
                            throw new Error(`Input do cliente não encontrado: ${selectorCliente}`);
                        });

                    const numeroClientInput = await page.$(selectorCliente);
                    if (numeroClientInput) {
                        await numeroClientInput.click({ clickCount: 3 });
                        await numeroClientInput.type(numeroCliente, { delay: 200 });
                        logger.info(`Número do cliente digitado: ${numeroCliente}`);

                        // Screenshot após preencher o número do cliente
                        await takeScreenshot(page, sessionId, '06_numero_cliente_preenchido', screenshotPath);
                    } else {
                        logger.error(`Elemento com ID ${selectorCliente} não encontrado na página após espera`);
                        await takeScreenshot(page, sessionId, '06_erro_cliente_nao_encontrado', screenshotPath);
                        throw new Error(`Elemento não encontrado após espera: ${selectorCliente}`);
                    }
                } else {
                    logger.error("Input para número do cliente não encontrado ou sem ID");
                    throw new Error("Input para número do cliente não encontrado ou sem ID");
                }

                // Aguardar um pouco entre as interações
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Verificar se o input do CPF existe e tem ID
                if (selectedInputs[1] && selectedInputs[1].id) {
                    const selectorCpf = `#${selectedInputs[1].id}`;

                    // Aguardar até que o elemento seja clicável
                    await page.waitForSelector(selectorCpf, { visible: true, timeout: 10000 })
                        .catch(error => {
                            logger.error(`Timeout ao aguardar input do CPF: ${error.message}`);
                            throw new Error(`Input do CPF não encontrado: ${selectorCpf}`);
                        });

                    const numeroCpfInput = await page.$(selectorCpf);
                    if (numeroCpfInput) {
                        await numeroCpfInput.click({ clickCount: 3 });
                        await numeroCpfInput.type(cpfCnpj, { delay: 200 });
                        logger.info(`CPF/CNPJ digitado: ${cpfCnpj}`);

                        // Screenshot após preencher o CPF/CNPJ
                        await takeScreenshot(page, sessionId, '07_cpf_preenchido', screenshotPath);
                    } else {
                        logger.error(`Elemento com ID ${selectorCpf} não encontrado na página após espera`);
                        await takeScreenshot(page, sessionId, '07_erro_cpf_nao_encontrado', screenshotPath);
                        throw new Error(`Elemento não encontrado após espera: ${selectorCpf}`);
                    }
                } else {
                    logger.error("Input para CPF não encontrado ou sem ID");
                    throw new Error("Input para CPF não encontrado ou sem ID");
                }

                // Handle hCaptcha
                try {
                    // Screenshot antes de lidar com o captcha
                    await takeScreenshot(page, sessionId, '08_antes_captcha', screenshotPath);
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

                        // Screenshot do captcha encontrado
                        await takeScreenshot(page, sessionId, '09_captcha_encontrado', screenshotPath);

                        const captchaScreenshotPath = path.join(__dirname, '../public/captcha-screenshot.png');
                        await page.screenshot({ path: captchaScreenshotPath, fullPage: true });
                        logger.info(`Saved captcha screenshot to ${captchaScreenshotPath}`);

                        const publicScreenshotPath = path.join(__dirname, '../public/captcha-screenshot.png');
                        fs.copyFileSync(captchaScreenshotPath, publicScreenshotPath);

                        logger.info("Waiting for human to solve captcha...");

                        // Usar a porta 3007 quando estiver rodando localmente, ou a porta 3000 dentro do Docker
                        const captchaServerUrl = process.env.RUNNING_IN_DOCKER === 'true'
                            ? 'http://captcha-server:3000'
                            : 'http://localhost:3007';

                        logger.info(`Please open ${captchaServerUrl}/pending in your browser to solve the captcha`);
                        logger.info(`The site key being used is: ${hcaptchaSiteKey}`);

                        // if (webhookUrl) {
                        //     await webhookQueue.add('job-waiting-captcha', {
                        //         url: webhookUrl,
                        //         payload: {
                        //             id: jobId,
                        //             status: 'waiting-captcha',
                        //             message: 'Waiting for human to solve captcha'
                        //         }
                        //     });
                        // }


                        try {
                            const token = await captchaServer.submitCaptcha(
                                hcaptchaSiteKey,
                                page.url(),
                                webhookUrl,
                                jobId
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
                            throw captchaError;
                        }
                    } else {
                        logger.warn("Could not find hCaptcha site key on the page");
                        throw new Error("Could not find hCaptcha site key on the page")
                    }
                } catch (captchaError) {
                    logger.error("Error handling captcha:", captchaError);
                    throw captchaError;
                }

                await new Promise((resolve) => setTimeout(resolve, 1000));

                await takeScreenshot(page, sessionId, '10_antes_de_clicar_no_submit', screenshotPath);

                // Finally, click the submit button after CAPTCHA is solved 
                const submitButton = await page.$("#CONTENT_Formulario_Solicitar");
                if (submitButton) {
                    await submitButton.click();
                    logger.info("Clicked submit button");
                }
                await takeScreenshot(page, sessionId, '11_depois_de_clicar_no_submit', screenshotPath);

                await new Promise((resolve) => setTimeout(resolve, 5000));

                await takeScreenshot(page, sessionId, '12_depois_5_segundos', screenshotPath);

                // Usar o centralizador de verificação de código para lidar com ambos os métodos (telefone e email)
                logger.info("Using centralized verification code handler...");

                // Usar o método handleVerificationCodeUI que gerencia toda a interação com a página
                // e escolhe automaticamente entre telefone e email com base na disponibilidade
                const verificationCode = await handleVerificationCodeUI(
                    page,
                    VerificationMethod.ANY, // Tentar qualquer método disponível
                    jobId,
                    screenshotPath,
                    sessionId,
                    takeScreenshot
                );

                // Preencher o código no formulário se foi obtido com sucesso
                const verificationCodeInput = await page.$("#CONTENT_Formulario_CodigoSeguranca");
                if (verificationCodeInput && verificationCode) {
                    await verificationCodeInput.click();
                    await verificationCodeInput.type(verificationCode, { delay: 200 });
                    logger.info("Successfully entered verification code");
                } else if (!verificationCode) {
                    throw new Error("Failed to get verification code from any method");
                }

                await takeScreenshot(page, sessionId, '20_codigo_email_escrito', screenshotPath);

                const submitCodeButton = await page.$("#CONTENT_Formulario_ProximoSt4");
                if (submitCodeButton) {
                    await submitCodeButton.click();
                    logger.info("Clicked submit code button");
                }

                await takeScreenshot(page, sessionId, '21_depois_de_clicar_no_botao_de_submit', screenshotPath);

                await new Promise((resolve) => setTimeout(resolve, 25000));

                await takeScreenshot(page, sessionId, '22_depois_25_segundos', screenshotPath);

                await page.waitForSelector('#CONTENT_segviarapida_GridViewSegVia tbody tr', { timeout: 60 * 1000 * 2 });


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
                                resolveMonth("");
                                return;
                            }

                            await new Promise(r => setTimeout(r, 5000));



                            const downloadButton = await page.$("#CONTENT_segviarapida_btnSalvarPDF");
                            if (downloadButton) {
                                await downloadButton.click();
                                logger.info(`Clicked download button for month ${mes}`);
                            } else {
                                logger.warn("Download button not found");
                                resolveMonth("");
                                return;
                            }

                            await takeScreenshot(page, sessionId, '23_depois_de_clicar_no_botao_de_download', screenshotPath);

                            await new Promise(r => setTimeout(r, 15000));

                            await page.evaluate(() => {
                                const buttons = document.querySelectorAll('button');
                                const button = Array.from(buttons).find(btn => btn.textContent?.trim() === 'Ok') || null;
                                if (button) {
                                    button.click();
                                }
                            });

                            await takeScreenshot(page, sessionId, '24_depois_de_clicar_no_botao_de_ok', screenshotPath);


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

                                console.log({
                                    pdfFiles
                                });

                                if (pdfFiles.length > 0) {
                                    // Pegar o arquivo PDF mais recente
                                    const mostRecentPdf = pdfFiles
                                        .map(file => ({ file, mtime: fs.statSync(path.join(downloadPath, file)).mtime }))
                                        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0].file;

                                    const downloadedPath = path.join(downloadPath, mostRecentPdf);
                                    const newPath = path.join(downloadPath, pdfFileName);

                                    console.log({
                                        downloadedPath,
                                        newPath
                                    })

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
                                    resolveMonth("");
                                    return;
                                }

                                logger.info(`PDF for month ${mes} not found yet, waiting... (attempt ${attempts}/${maxAttempts})`);
                                setTimeout(checkFileExists, 2000);
                            };

                            // Iniciar a verificação do arquivo
                            setTimeout(checkFileExists, 2000);
                        } catch (error: any) {
                            logger.error(`Error downloading PDF for month ${mes}:`, error);
                            resolveMonth("");
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

                    if (downloadedPdfs.length === 0) {
                        logger.error('No PDFs downloaded for any month');
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
                // await browser.close();
                logger.info(`Browser closed`);
            }
        }).catch(error => {
            logger.error("Failed to launch browser:", error);
            reject(error);
        });
    });
}