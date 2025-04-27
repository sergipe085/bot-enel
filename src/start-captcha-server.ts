import { captchaServer } from './captcha-server-new';
import { logger } from './lib/logger';

/**
 * Start the captcha server as a standalone process
 */
async function main() {
  try {
    await captchaServer.start();
    logger.info('Captcha server started successfully');
    const port = process.env.RUNNING_IN_DOCKER === 'true' ? 3000 : 3007;
    logger.info(`Open http://localhost:${port}/pending in your browser to see pending captchas`);
    logger.info('Press Ctrl+C to stop the server');
  } catch (error) {
    logger.error('Failed to start captcha server:', error);
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
  process.exit(0);
});
