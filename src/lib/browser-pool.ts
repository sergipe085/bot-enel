import puppeteer from 'puppeteer-extra';
import { Browser } from 'puppeteer';
import { logger } from './logger';

/**
 * Gerenciador de pool de browsers para limitar o número de instâncias do Puppeteer
 */
class BrowserPoolManager {
    private maxConcurrentBrowsers: number;
    private activeBrowsers: Map<string, Browser>;
    private browserQueue: Array<{
        resolve: (browser: Browser) => void;
        reject: (error: Error) => void;
        config: any;
        id: string;
    }>;
    private isProcessingQueue: boolean;

    constructor(maxConcurrentBrowsers: number = 3) {
        this.maxConcurrentBrowsers = maxConcurrentBrowsers;
        this.activeBrowsers = new Map();
        this.browserQueue = [];
        this.isProcessingQueue = false;

        logger.info(`Browser pool initialized with max ${maxConcurrentBrowsers} concurrent browsers`);
    }

    /**
     * Obtém ou cria uma instância de browser
     */
    async getBrowser(config: any, id: string): Promise<Browser> {
        // Se já temos um browser ativo para este ID, retorna ele
        if (this.activeBrowsers.has(id)) {
            logger.info(`Reusing existing browser for job ${id}`);
            return this.activeBrowsers.get(id);
        }

        // Se ainda não atingimos o limite, cria um novo browser
        if (this.activeBrowsers.size < this.maxConcurrentBrowsers) {
            return this.launchBrowser(config, id);
        }

        // Caso contrário, adiciona à fila
        logger.info(`Browser limit reached (${this.activeBrowsers.size}/${this.maxConcurrentBrowsers}), queuing browser request for job ${id}`);
        logger.info(`Current queue length: ${this.browserQueue.length}`);

        return new Promise<Browser>((resolve, reject) => {
            this.browserQueue.push({ resolve, reject, config, id });

            // Inicia o processamento da fila se ainda não estiver em andamento
            if (!this.isProcessingQueue) {
                this.processQueue();
            }
        });
    }

    /**
     * Libera um browser do pool
     */
    async releaseBrowser(id: string): Promise<void> {
        if (this.activeBrowsers.has(id)) {
            const browser = this.activeBrowsers.get(id);
            this.activeBrowsers.delete(id);

            try {
                await browser.close();
                logger.info(`Browser for job ${id} closed and released from pool`);
            } catch (error) {
                logger.error(`Error closing browser for job ${id}:`, error);
            }

            // Processa a fila após liberar um browser
            this.processQueue();
        }
    }

    /**
     * Processa a fila de solicitações de browser
     */
    private async processQueue(): Promise<void> {
        if (this.browserQueue.length === 0 || this.activeBrowsers.size >= this.maxConcurrentBrowsers) {
            this.isProcessingQueue = false;
            return;
        }

        this.isProcessingQueue = true;

        // Pega o próximo item da fila
        const nextItem = this.browserQueue.shift();

        try {
            logger.info(`Processing queued browser request for job ${nextItem.id}`);
            const browser = await this.launchBrowser(nextItem.config, nextItem.id);
            nextItem.resolve(browser);
        } catch (error) {
            logger.error(`Error launching browser for queued job ${nextItem.id}:`, error);
            nextItem.reject(error);
        }

        // Continua processando a fila
        setTimeout(() => this.processQueue(), 1000);
    }

    /**
     * Lança uma nova instância do browser
     */
    private async launchBrowser(config: any, id: string): Promise<Browser> {
        logger.info(`Launching new browser for job ${id} (${this.activeBrowsers.size + 1}/${this.maxConcurrentBrowsers})`);

        try {
            const browser = await puppeteer.launch(config);
            this.activeBrowsers.set(id, browser);

            // Configurar evento para quando o browser fechar
            browser.on('close', () => {
                logger.info(`Browser for job ${id} closed`);
                this.activeBrowsers.delete(id);
                this.processQueue();
            });

            return browser;
        } catch (error) {
            logger.error(`Failed to launch browser for job ${id}:`, error);
            throw error;
        }
    }

    /**
     * Fecha todos os browsers ativos
     */
    async closeAll(): Promise<void> {
        logger.info(`Closing all ${this.activeBrowsers.size} active browsers`);

        const closePromises = [];
        for (const [id, browser] of this.activeBrowsers.entries()) {
            closePromises.push(browser.close().catch(error => {
                logger.error(`Error closing browser for job ${id}:`, error);
            }));
        }

        await Promise.all(closePromises);
        this.activeBrowsers.clear();
        logger.info('All browsers closed');
    }

    /**
     * Retorna o número atual de browsers ativos
     */
    getActiveBrowserCount(): number {
        return this.activeBrowsers.size;
    }

    /**
     * Retorna o tamanho atual da fila
     */
    getQueueLength(): number {
        return this.browserQueue.length;
    }
}

// Exporta uma instância única do gerenciador de pool
export const browserPool = new BrowserPoolManager(2); // Limita a 2 browsers simultâneos
