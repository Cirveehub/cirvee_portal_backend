import { CronJob } from "cron";
import prisma from "@config/database";
import logger from "@utils/logger";
import { EmailUtil } from "@utils/email";
import nodemailer from "nodemailer"; // Can be removed if unused
import { QueueService } from "../../services/queue.service";

// Simple money helper
const formatNaira = (kobo: number): string => 
  `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export class PaymentScheduler {
  private static job: CronJob;

  static init() {
    // Run every day at 9:00 AM
    // Cron pattern: 0 9 * * *
    this.job = new CronJob(
      "0 9 * * *",
      async () => {
        logger.info("Running daily payment reminder check...");
        await this.checkPaymentReminders();
      },
      null,
      true, // start immediately (well, actually this argument is 'start', so true means it starts the timer)
      "Africa/Lagos" // Timezone
    );
    
    logger.info("Payment scheduler initialized (0 9 * * *)");
  }

  static async checkPaymentReminders() {
    try {
      // Find active payments with outstanding balance
      const payments = await prisma.payment.findMany({
        where: {
          status: { in: ["PROCESSING", "PENDING"] }, 
          balanceKobo: { gt: 0 },
          installmentPlan: "TWO_INSTALLMENTS", // Reminders mostly relevant for installments
          student: {
            enrollments: {
              some: { status: "ACTIVE" }
            }
          },
        },
        include: {
          student: {
            include: {
              user: true
            }
          },
          cohort: true,
          course: true,
          auditLogs: {
            where: {
              action: "PAYMENT_REMINDER",
              timestamp: {
                gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
              }
            }
          }
        }
      });

      logger.info(`Found ${payments.length} payments with outstanding balance to check for reminders.`);

      for (const payment of payments) {
        try {
            await this.processPaymentReminder(payment);
        } catch (err) {
            logger.error(`Error processing reminder for payment ${payment.id}:`, err);
        }
      }

    } catch (error) {
      logger.error("Error in checkPaymentReminders:", error);
    }
  }

  private static async processPaymentReminder(payment: any) {
    // Check if reminder sent recently
    if (payment.auditLogs.length > 0) {
        logger.info(`Skipping reminder for ${payment.student.user.email} - already sent in last 7 days`);
        return;
    }

    const { startDate } = payment.cohort;
    const { duration } = payment.course; // duration in weeks

    if (!startDate || !duration) return;

    const durationMilliseconds = duration * 7 * 24 * 60 * 60 * 1000;
    const thresholdDate = new Date(startDate.getTime() + (durationMilliseconds * 0.4)); // 40% mark

    // If current date is AFTER the 40% threshold
    if (Date.now() >= thresholdDate.getTime()) {
        
        logger.info(`Sending payment reminder to ${payment.student.user.email}. Course passed 40% duration.`);

        // Send Email via Queue
        await QueueService.addEmailJob({
            type: 'PAYMENT_REMINDER',
            payload: {
                email: payment.student.user.email,
                firstName: payment.student.user.firstName,
                courseTitle: payment.course.title,
                balanceKobo: payment.balanceKobo,
                dueDate: payment.secondInstallmentDueDate
            }
        });

        // Log action
        await prisma.paymentAuditLog.create({
            data: {
                paymentId: payment.id,
                action: "PAYMENT_REMINDER",
                description: "Automated payment reminder sent (40% completion threshold reached)",
                actorType: "SYSTEM",
                metadata: {
                    balance: formatNaira(payment.balanceKobo),
                    threshold_date: thresholdDate
                }
            }
        });
    }
  }

  // sendReminderEmail method removed as logic is now in EmailWorker/Util
}
