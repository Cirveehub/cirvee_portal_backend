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
    age: 24 * 3600, // keep up to 24 hours
    count: 1000, // keep up to 1000 jobs
  },
  removeOnFail: {
    age: 24 * 3600 * 7, // keep up to 7 days
  },
};
