import { Worker } from 'bullmq';
import { QUEUES } from '../config/queue';
import { REDIS_URL, redisConfig } from '../config/redis';
import logger from '../utils/logger';
import { EmailUtil } from '../utils/email';
import Redis from 'ioredis';


const connection = new Redis(REDIS_URL, {
  ...redisConfig,
  maxRetriesPerRequest: null
});

const worker = new Worker(QUEUES.EMAIL, async (job) => {
  logger.info(`Processing email job ${job.id} of type ${job.name}`);
  const { type, payload } = job.data;
  
  try {
    switch (job.name) {
      case 'VERIFICATION':
        await EmailUtil.sendVerificationEmail(payload.email, payload.name, payload.otp);
        break;
      case 'PASSWORD_RESET':
        await EmailUtil.sendPasswordResetEmail(payload.email, payload.name, payload.resetToken);
        break;
      case 'WELCOME':
        await EmailUtil.sendWelcomeEmail(payload.email, payload.name, payload.studentId);
        break;
      case 'STAFF_CREDENTIALS':
        await EmailUtil.sendStaffCredentialsEmail(payload.email, payload.name, payload.staffId, payload.password, payload.role);
        break;
      case 'PAYMENT_REMINDER':
        await EmailUtil.sendPaymentReminderEmail(
            payload.email, 
            payload.firstName, 
            payload.courseTitle, 
            payload.balanceKobo, 
            payload.dueDate
        );
        break;
      case 'ASSIGNMENT_CREATED':
        await EmailUtil.sendAssignmentCreatedEmail(
            payload.email,
            payload.studentName,
            payload.assignmentTitle,
            payload.courseTitle,
            payload.dueDate
        );
        break;
      case 'ANNOUNCEMENT_NEW':
        await EmailUtil.sendAnnouncementEmail(
            payload.email,
            payload.name,
            payload.title,
            payload.content,
            payload.senderName
        );
        break;
      default:
        logger.warn(`Unknown email job type: ${job.name}`);
    }
  } catch (error: any) {
    logger.error(`Failed to process email job ${job.id}:`, error);
    throw error;
  }
}, {
  connection
});

worker.on('completed', (job) => {
  logger.info(`Email job ${job.id} completed`);
});

worker.on('failed', (job, err) => {
  logger.error(`Email job ${job?.id} failed: ${err.message}`);
});

export default worker;
