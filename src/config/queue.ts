import { JobsOptions } from 'bullmq';

export const QUEUES = {
  EMAIL: 'email-queue',
};

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    age: 24 * 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 24 * 3600 * 7,
  },
};
