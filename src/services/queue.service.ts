import { Queue } from 'bullmq';
import { QUEUES, DEFAULT_JOB_OPTIONS } from '../config/queue';
import redis from '../config/redis';

// Use separate connection for adding jobs? 
// BullMQ documentation: "It is possible to reuse the connection from ioredis... using the connection option."
// redis export from config/redis is an ioredis instance.

const emailQueue = new Queue(QUEUES.EMAIL, {
  connection: redis,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export class QueueService {
  //Add an email job to the queue
  static async addEmailJob(data: { 
    type: 'VERIFICATION' | 'PASSWORD_RESET' | 'WELCOME' | 'STAFF_CREDENTIALS' | 'PAYMENT_REMINDER' | 'ASSIGNMENT_CREATED' | 'ANNOUNCEMENT_NEW';
    payload: any 
  }) {
    // { type, payload }
    return emailQueue.add(data.type, data);
  }

  static get queues() {
    return [emailQueue];
  }
}
