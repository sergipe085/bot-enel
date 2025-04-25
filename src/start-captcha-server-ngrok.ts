import { captchaServer } from './captcha-server-with-ngrok';
import { logger } from './lib/logger';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// File to store the ngrok URL
const NGROK_URL_FILE = path.join(__dirname, '../.ngrok-url');

/**
 * Start ngrok tunnel for the captcha server
 * @param port The port to tunnel
 * @returns Promise with the public URL
 */
async function startNgrok(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    logger.info(`Starting ngrok tunnel for port ${port}...`);

    // Start ngrok process
    const ngrok = spawn('ngrok', ['http', port.toString()]);

    // Handle ngrok output to extract the URL
    ngrok.stdout.on('data', (data) => {
      const output = data.toString();
      logger.info(`ngrok: ${output}`);
    });

    // Check for errors
    ngrok.stderr.on('data', (data) => {
      const error = data.toString();
      logger.error(`ngrok error: ${error}`);

      if (error.includes('error')) {
        reject(new Error(`ngrok error: ${error}`));
      }
    });

    // Handle process exit
    ngrok.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ngrok process exited with code ${code}`));
      }
    });

    // Use the ngrok API to get the public URL
    setTimeout(async () => {
      try {
        const response = await fetch('http://localhost:4040/api/tunnels');
        const tunnels = await response.json();

        if (tunnels && tunnels.tunnels && tunnels.tunnels.length > 0) {
          const publicUrl = tunnels.tunnels[0].public_url;
          logger.info(`ngrok tunnel established: ${publicUrl}`);

          // Save the URL to a file so the scraper can use it
          fs.writeFileSync(NGROK_URL_FILE, publicUrl);

          resolve(publicUrl);
        } else {
          reject(new Error('No ngrok tunnels found'));
        }
      } catch (error) {
        reject(new Error(`Failed to get ngrok URL: ${error.message}`));
      }
    }, 3000); // Wait for ngrok to start
  });
}

/**
 * Get the ngrok URL from the file if it exists
 * @returns The ngrok URL or null if not found
 */
export function getNgrokUrl(): string | null {
  try {
    if (fs.existsSync(NGROK_URL_FILE)) {
      const url = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
      return url;
    }
  } catch (error) {
    logger.error(`Failed to read ngrok URL file: ${error.message}`);
  }
  return null;
}

/**
 * Start the captcha server with ngrok
 */
async function main() {
  try {
    // Start the captcha server
    const port = 3000;
    await captchaServer.start();
    logger.info('Captcha server started successfully');

    // Start ngrok tunnel
    const publicUrl = await startNgrok(port);

    logger.info(`Captcha server is now accessible at: ${publicUrl}`);
    logger.info(`Open ${publicUrl}/pending in your browser to see pending captchas`);
    logger.info('Press Ctrl+C to stop the server');

    // Keep the process running
    process.stdin.resume();
  } catch (error) {
    logger.error('Failed to start captcha server with ngrok:', error);
    process.exit(1);
  }
}

// Run the main function
main();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down captcha server...');
  await captchaServer.stop();
  logger.info('Captcha server stopped');

  // Remove the ngrok URL file
  try {
    if (fs.existsSync(NGROK_URL_FILE)) {
      fs.unlinkSync(NGROK_URL_FILE);
    }
  } catch (error) {
    logger.error(`Failed to remove ngrok URL file: ${error.message}`);
  }

  process.exit(0);
});
