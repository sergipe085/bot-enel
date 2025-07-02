import express from 'express';
import { Server } from 'http';
import path from 'path';
import { logger } from './lib/logger';
import * as fs from 'fs';
import { webhookQueue } from './queues/webhook-queue';

interface CaptchaRequest {
  id: string;
  siteKey: string;
  url: string;
  status: 'pending' | 'solved' | 'timeout';
  token?: string;
  createdAt: Date;
}

/**
 * CaptchaServer manages human-in-the-loop captcha solving
 * It provides a web interface for humans to solve captchas and
 * an API for the scraper to submit captchas and retrieve solutions
 */
export class CaptchaServer {
  private app: express.Express;
  private server: Server | null = null;
  private captchaRequests: Map<string, CaptchaRequest> = new Map();
  private port: number;

  constructor(port?: number) {
    // Usar porta 3000 dentro do Docker e 3007 fora do Docker, a menos que seja explicitamente especificada
    if (port) {
      this.port = port;
    } else {
      this.port = process.env.RUNNING_IN_DOCKER === 'true' ? 3000 : 3007;
    }

    this.app = express();
    this.setupServer();
  }

  /**
   * Configure the Express server
   */
  private setupServer(): void {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../public')));

    // Create the public directory if it doesn't exist
    const publicDir = path.join(__dirname, '../public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    // Setup routes
    this.setupRoutes();

    // Clean up old requests (older than 30 minutes)
    setInterval(() => {
      const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);

      for (const [id, request] of this.captchaRequests.entries()) {
        if (request.createdAt < thirtyMinutesAgo) {
          if (request.status === 'pending') {
            request.status = 'timeout';
          }
          this.captchaRequests.delete(id);
          logger.info(`Removed old captcha request: ${id}`);
        }
      }
    }, 5 * 60 * 1000); // Run every 5 minutes
  }

  /**
   * Setup Express routes
   */
  private setupRoutes(): void {
    // API endpoint to submit a new captcha request
    this.app.post('/api/captcha/request', this.handleCaptchaRequest.bind(this));

    // API endpoint to check captcha status
    this.app.get('/api/captcha/status/:id', this.handleCaptchaStatus.bind(this));

    // API endpoint to submit a solved captcha
    this.app.post('/api/captcha/solve/:id', this.handleCaptchaSolve.bind(this));

    // Route to display the captcha solver UI
    this.app.get('/solve/:id', this.handleSolvePage.bind(this));

    // List all pending captchas
    this.app.get('/pending', this.handlePendingPage.bind(this));

    // API to get all pending captchas
    this.app.get('/api/captcha/pending', this.handlePendingCaptchas.bind(this));
  }

  /**
   * Handle new captcha request
   */
  private handleCaptchaRequest(req: express.Request, res: express.Response): express.Response {
    const { siteKey, url } = req.body;

    if (!siteKey || !url) {
      return res.status(400).json({ error: 'Missing siteKey or url' });
    }

    const id = Date.now().toString();
    const captchaRequest: CaptchaRequest = {
      id,
      siteKey,
      url,
      status: 'pending',
      createdAt: new Date()
    };

    this.captchaRequests.set(id, captchaRequest);
    logger.info(`New captcha request created: ${id}`);

    return res.json({ id });
  }

  /**
   * Handle captcha status check
   */
  private handleCaptchaStatus(req: express.Request, res: express.Response): express.Response {
    const { id } = req.params;
    const request = this.captchaRequests.get(id);

    if (!request) {
      return res.status(404).json({ error: 'Captcha request not found' });
    }

    return res.json({
      id: request.id,
      status: request.status,
      token: request.token,
      siteKey: request.siteKey
    });
  }

  /**
   * Handle captcha solution submission
   */
  private handleCaptchaSolve(req: express.Request, res: express.Response): express.Response {
    const { id } = req.params;
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Missing token' });
    }

    const request = this.captchaRequests.get(id);
    if (!request) {
      return res.status(404).json({ error: 'Captcha request not found' });
    }

    request.status = 'solved';
    request.token = token;
    this.captchaRequests.set(id, request);

    logger.info(`Captcha solved for request: ${id}`);
    return res.json({ success: true });
  }

  /**
   * Handle captcha solver page
   */
  private handleSolvePage(req: express.Request, res: express.Response): void {
    const { id } = req.params;
    const request = this.captchaRequests.get(id);

    if (!request) {
      res.status(404).send('Captcha request not found');
      return;
    }

    // Log the site key for debugging
    logger.info(`Serving captcha solver for request ${id} with site key: ${request.siteKey}`);

    // Use the new captcha solver page
    res.sendFile(path.join(__dirname, '../public/captcha-solver-new.html'));
  }

  /**
   * Handle pending captchas page
   */
  private handlePendingPage(_req: express.Request, res: express.Response): void {
    res.sendFile(path.join(__dirname, '../public/pending-captchas.html'));
  }

  /**
   * Handle API request for pending captchas
   */
  private handlePendingCaptchas(_req: express.Request, res: express.Response): void {
    const pendingRequests = Array.from(this.captchaRequests.values())
      .filter(request => request.status === 'pending')
      .map(request => ({
        id: request.id,
        url: request.url,
        siteKey: request.siteKey,
        createdAt: request.createdAt
      }));

    res.json(pendingRequests);
  }

  /**
   * Start the captcha server
   */
  public start(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        logger.info(`Captcha server already running at http://localhost:${this.port}`);
        resolve();
        return;
      }

      this.server = this.app.listen(this.port, () => {
        logger.info(`Captcha server running at http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop the captcha server
   */
  public stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Submit a captcha for human solving
   * @param siteKey The hCaptcha site key
   * @param url The URL where the captcha is located
   * @returns Promise with the solved captcha token
   */
  public async submitCaptcha(siteKey: string, url: string, webhookUrl?: string, jobId?: string): Promise<string> {
    // Determinar o host correto baseado no ambiente
    const baseUrl = process.env.RUNNING_IN_DOCKER === 'true'
      ? 'http://captcha-server:3000'
      : `http://localhost:${this.port}`;

    // Create a new captcha request
    const response = await fetch(`${baseUrl}/api/captcha/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ siteKey, url })
    });

    const data = await response.json();
    const { id } = data;

    // URL para exibição ao usuário (sempre usando localhost com a porta correta)
    const userVisibleUrl = process.env.RUNNING_IN_DOCKER === 'true'
      ? `http://193.203.182.11:3007/solve/${id}`
      : `http://193.203.182.11:${this.port}/solve/${id}`;

    if (webhookUrl) {
      await webhookQueue.add('job-waiting-captcha', {
        url: webhookUrl,
        payload: {
          id: jobId,
          status: 'waiting-captcha',
          message: 'Waiting for human to solve captcha',
          url: userVisibleUrl
        }
      });
    }

    logger.info(`Submitted captcha request ${id}, waiting for human to solve at ${userVisibleUrl}`);

    // Poll for the solution
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(async () => {
        try {
          const statusResponse = await fetch(`${baseUrl}/api/captcha/status/${id}`);
          const statusData = await statusResponse.json();

          if (statusData.status === 'solved' && statusData.token) {
            clearInterval(checkInterval);


            if (webhookUrl) {
              await webhookQueue.add('job-captcha-solved', {
                url: webhookUrl,
                payload: {
                  id: jobId,
                  status: 'captcha-solved',
                  message: 'Captcha solved',
                  url: userVisibleUrl
                }
              });
            }
            resolve(statusData.token);
          } else if (statusData.status === 'timeout') {
            clearInterval(checkInterval);
            reject(new Error('Captcha solving timed out'));
          }
        } catch (error: any) {
          logger.error(`Error checking captcha status: ${error.message}`);
        }
      }, 2000); // Check every 2 seconds

      // Set a timeout of 5 minutes
      setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error('Captcha solving timed out after 30 minutes'));
      }, 30 * 60 * 1000);
    });
  }
}

// Export a singleton instance
export const captchaServer = new CaptchaServer();
