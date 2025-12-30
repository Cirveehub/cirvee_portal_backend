import Redis, { RedisOptions } from "ioredis";
import logger from "../utils/logger";

// const redis = new Redis({
//   host: process.env.REDIS_HOST || "localhost",
//   port: parseInt(process.env.REDIS_PORT || "6379"),
//   password: process.env.REDIS_PASSWORD || undefined,
//   retryStrategy: (times) => {
//     const delay = Math.min(times * 50, 2000);
//     return delay;
//   },
//   maxRetriesPerRequest: 3,
// });

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error("REDIS_URL is not defined");
}

export const REDIS_URL = redisUrl;

export const redisConfig: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

const redis = new Redis(redisUrl, redisConfig);

redis.on("connect", () => {
  logger.info("Redis connected ");
});

redis.on("ready", () => {
  logger.info("Redis is ready to accept commands");
});

redis.on("error", (error) => {
  logger.error("Redis connection error:", error);
});

redis.on("close", () => {
  logger.warn(" Redis connection closed");
});

// Test Redis connection
export const testRedis = async (): Promise<boolean> => {
  try {
    await redis.set("test_key", "test_value", "EX", 10);
    const value = await redis.get("test_key");
    if (value === "test_value") {
      logger.info(" Redis test successful");
      await redis.del("test_key");
      return true;
    }
    return false;
  } catch (error) {
    logger.error("❌Redis test failed:", error);
    return false;
  }
};

export default redis;
