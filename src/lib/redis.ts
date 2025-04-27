import Redis from 'ioredis';

// Configuração para permitir conexão tanto em ambiente local quanto em Docker
const redisHost = process.env.REDIS_HOST || '127.0.0.1';
const redisPort = parseInt(process.env.REDIS_PORT || '6379');
const redisUrl = process.env.REDIS_URL;

// Criar conexão com Redis baseado na URL ou nas configurações de host/port
export const redisConnection = redisUrl
    ? new Redis(redisUrl)
    : new Redis({
        host: redisHost,
        port: redisPort,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
    });