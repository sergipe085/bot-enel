/**
 * Options for the RetriablePromise
 */
interface RetriablePromiseOptions<T> {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries?: number;
    /** Delay between retries in milliseconds (default: 1000) */
    delayMs?: number;
    /** Function to execute when an error occurs, before retrying */
    onError?: (error: unknown, attempt: number) => Promise<void>;
}

/**
 * A class that wraps a promise-returning function with retry capability
 * and custom error handling between attempts
 */
export class RetriablePromise<T> {
    private promiseFn: () => Promise<T>;
    private maxRetries: number;
    private delayMs: number;
    private onError?: (error: unknown, attempt: number) => Promise<void>;

    /**
     * Creates a retriable promise with custom error handling
     * @param promiseFn - Function that returns a promise to execute
     * @param options - Configuration options
     */
    constructor(promiseFn: () => Promise<T>, options: RetriablePromiseOptions<T> = {}) {
        this.promiseFn = promiseFn;
        this.maxRetries = options.maxRetries ?? 3;
        this.delayMs = options.delayMs ?? 1000;
        this.onError = options.onError;
    }

    /**
     * Execute the promise with retries
     * @returns Result of the promise function
     */
    async execute(): Promise<T> {
        let attempts = 0;

        while (attempts <= this.maxRetries) {
            try {
                return await this.promiseFn();
            } catch (error) {
                attempts++;

                if (attempts > this.maxRetries) {
                    throw new Error(`Failed after ${this.maxRetries} attempts. Last error: ${error instanceof Error ? error.message : String(error)}`);
                }

                console.log(`Attempt ${attempts} failed. Retrying...`);

                // Execute custom onError handler if provided
                if (this.onError) {
                    await this.onError(error, attempts);
                }

                // Wait before retrying
                if (this.delayMs > 0) {
                    await new Promise(resolve => setTimeout(resolve, this.delayMs));
                }
            }
        }

        // This should never be reached due to the error thrown in the loop,
        // but TypeScript needs a return statement
        throw new Error("Unexpected execution path");
    }
}