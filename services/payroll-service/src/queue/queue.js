const { Queue } = require('bullmq');
const IORedis = require('ioredis');
const { configs } = require('../utils/configs');

const createRedisConnection = (settings = configs) =>
  new IORedis({
    host: settings.redisHost,
    port: settings.redisPort,
    password: settings.redisPassword || undefined,
    maxRetriesPerRequest: null
  });

const createPayrollQueue = (settings = configs) => {
  const connection = createRedisConnection(settings);
  const queue = new Queue(settings.queueName, { connection });
  return { queue, connection };
};

module.exports = {
  createRedisConnection,
  createPayrollQueue
};
