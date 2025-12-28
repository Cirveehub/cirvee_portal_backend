import prisma from "@config/database";
import axios from "axios";
import crypto from "crypto";
import { BadRequestError, NotFoundError, ForbiddenError } from "@utils/httpErrors";
import logger from "@utils/logger";
import { InstallmentPlan, PaymentState, Prisma, PrismaClient } from "@prisma/client";

type InitiatePaymentResult = {
  payment: {
    id: string;
    reference: string;
    status: PaymentState;
    totalAmountKobo: number;
    paidAmountKobo: number;
    balanceKobo: number;
    installmentPlan: InstallmentPlan;
    firstInstallmentKobo: number | null;
    secondInstallmentKobo: number | null;
    secondInstallmentDueDate: Date | null;
    expiresAt: Date | null;
    paystackAuthUrl: string | null;
    paystackAccessCode: string | null;
    student: {
      id: string;
      studentId: string;
      user: {
        firstName: string;
        lastName: string;
        email: string;
      };
    };
    cohort: {
      id: string;
      name: string;
      startDate: Date;
    };
    course: {
      id: string;
      title: string;
    };
  };
  authorizationUrl: string | null;
  accessCode: string | null;
  reference: string;
  reused: boolean;
};

type PaymentApiResponse = {
  id: string;
  reference: string;
  status: PaymentState;
  totalAmount: string;
  paidAmount: string;
  balance: string;
  installmentPlan: InstallmentPlan;
  student: {
    id: string;
    studentId: string;
    fullName: string;
    email: string;
  };
  cohort: {
    id: string;
    name: string;
    startDate: Date;
  };
  course: {
    id: string;
    title: string;
  };
};



// Money utilities - Convert between Naira and Kobo
const MoneyUtils = {
  toKobo: (naira: number): number => Math.round(naira * 100),
  toNaira: (kobo: number): number => kobo / 100,
  formatNaira: (kobo: number): string => `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
};

// Paystack  Configuration
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY!;
const PAYSTACK_BASE_URL = "https://api.paystack.co";
const MINIMUM_FIRST_INSTALLMENT_PERCENT = 50; // 50% minimum for first installment

interface InitiatePaymentData {
  studentId: string;
  userId: string;
  cohortId: string;
  fullName: string;
  email: string;
  phoneNumber?: string;
  installmentPlan: InstallmentPlan;
  metadata?: Record<string, any>;
}

export class PaymentService {
  
  //  HELPERS 
  
  private static generateReference(prefix: string = "PAY"): string {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  private static async callPaystack(endpoint: string, method: string = "POST", data?: any) {
    try {
      const response = await axios({
        method,
        url: `${PAYSTACK_BASE_URL}${endpoint}`,
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        data,
      });
      return response.data;
    } catch (error: any) {
      logger.error(`Paystack API Error: ${error.response?.data?.message || error.message}`);
      throw new Error(`Payment gateway error: ${error.response?.data?.message || error.message}`);
    }
  }

  private static async createAuditLog(
    paymentId: string,
    action: string,
    description: string,
    actor?: string,
    actorType: string = "SYSTEM",
    metadata?: any,
    tx?: any
  ) {
    const prismaClient = tx || prisma;
    
    await prismaClient.paymentAuditLog.create({
      data: {
        paymentId,
        action,
        description,
        actor,
        actorType,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined,
        timestamp: new Date(),
      },
    });
  }

  // Calculate installment breakdown
  private static calculateInstallments(totalKobo: number): {
    firstInstallmentKobo: number;
    secondInstallmentKobo: number;
  } {
    // First installment is 50% (minimum)
    const firstInstallmentKobo = Math.round(totalKobo * (MINIMUM_FIRST_INSTALLMENT_PERCENT / 100));
    const secondInstallmentKobo = totalKobo - firstInstallmentKobo;

    return { firstInstallmentKobo, secondInstallmentKobo };
  }

  //  INITIATE PAYMENT 
  
  static async initiatePayment(data: InitiatePaymentData, ipAddress?: string): Promise<InitiatePaymentResult> {
    // Generate idempotency key
    const idempotencyKey = this.generateReference("IDEM");

    // Check for duplicate request
    const existingPayment = await prisma.payment.findUnique({
  where: { idempotencyKey },
  include: {
    student: {
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    },
    cohort: {
      select: {
        id: true,
        name: true,
        startDate: true,
      },
    },
    course: {
      select: {
        id: true,
        title: true,
      },
    },
  },
});

    if (existingPayment) {
      logger.info(`Duplicate payment request detected: ${idempotencyKey}`);
      return {
        payment: existingPayment,
        authorizationUrl: existingPayment.paystackAuthUrl,
        accessCode: existingPayment.paystackAccessCode,
        reference: existingPayment.reference,
        reused: true,
    };
    }

    // Get cohort details
    const cohort = await prisma.$transaction(async (tx:PrismaClient) => {
      return await tx.cohort.findUnique({
        where: { id: data.cohortId },
        include: {
          course: { select: { id: true, title: true, price: true } },
        },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    if (!cohort) {
      throw new NotFoundError("Cohort not found");
    }

    // Check if student already has an active payment for this cohort
    const existingActivePayment = await prisma.payment.findFirst({
      where: {
        studentId: data.studentId,
        cohortId: data.cohortId,
        status: { in: ["PENDING", "PROCESSING", "COMPLETED"] },
      },
    });

    if (existingActivePayment) {
      if (existingActivePayment.status === "COMPLETED") {
        throw new BadRequestError("You have already paid for this cohort");
      }
      throw new BadRequestError("You already have a pending payment for this cohort");
    }

    // Check if already enrolled
    const existingEnrollment = await prisma.enrollment.findUnique({
      where: {
        studentId_cohortId: {
          studentId: data.studentId,
          cohortId: data.cohortId,
        },
      },
    });

    if (existingEnrollment) {
      throw new BadRequestError("You are already enrolled in this cohort");
    }

    // Convert price to kobo
    const totalAmountKobo = MoneyUtils.toKobo(Number(cohort.course.price));
    const reference = this.generateReference();

    // Calculate installment amounts
    let firstInstallmentKobo = totalAmountKobo;
    let secondInstallmentKobo = 0;
    let secondInstallmentDueDate: Date | undefined;

    if (data.installmentPlan === "TWO_INSTALLMENTS") {
      const breakdown = this.calculateInstallments(totalAmountKobo);
      firstInstallmentKobo = breakdown.firstInstallmentKobo;
      secondInstallmentKobo = breakdown.secondInstallmentKobo;
      
      // Second installment due in 30 days????
      secondInstallmentDueDate = new Date();
      secondInstallmentDueDate.setDate(secondInstallmentDueDate.getDate() + 30);
    }

    // Amount to charge now
    const amountToChargeKobo = data.installmentPlan === "FULL_PAYMENT" 
      ? totalAmountKobo 
      : firstInstallmentKobo;

    // Initialize Paystack transaction
    const paystackPayload = {
      email: data.email,
      amount: amountToChargeKobo,
      reference,
      currency: "NGN",
      callback_url: `${process.env.FRONTEND_URL}/payment/callback`,
      metadata: {
        payment_reference: reference,
        student_id: data.studentId,
        cohort_id: data.cohortId,
        course_id: cohort.course.id,
        course_title: cohort.course.title,
        full_name: data.fullName,
        phone_number: data.phoneNumber,
        installment_plan: data.installmentPlan,
        ...data.metadata,
      },
      channels: ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
    };

    const paystackResponse = await this.callPaystack("/transaction/initialize", "POST", paystackPayload);

    if (!paystackResponse.status) {
      throw new Error("Failed to initialize payment with Paystack");
    }

    // Create payment record with transaction
    const payment = await prisma.$transaction(async (tx:PrismaClient) => {
      const newPayment = await tx.payment.create({
        data: {
          reference,
          paystackReference: paystackResponse.data.reference,
          idempotencyKey,
          studentId: data.studentId,
          userId: data.userId,
          cohortId: data.cohortId,
          courseId: cohort.course.id,
          totalAmountKobo,
          paidAmountKobo: 0,
          balanceKobo: totalAmountKobo,
          status: "PENDING",
          currency: "NGN",
          installmentPlan: data.installmentPlan,
          firstInstallmentKobo: data.installmentPlan === "TWO_INSTALLMENTS" ? firstInstallmentKobo : null,
          secondInstallmentKobo: data.installmentPlan === "TWO_INSTALLMENTS" ? secondInstallmentKobo : null,
          secondInstallmentDueDate,
          paystackAuthUrl: paystackResponse.data.authorization_url,
          paystackAccessCode: paystackResponse.data.access_code,
          paystackChannels: ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
          ipAddress,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          metadata: data.metadata ? JSON.parse(JSON.stringify(data.metadata)) : undefined,
        },
        include: {
          student: {
            select: {
              id: true,
              studentId: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          cohort: {
            select: {
              id: true,
              name: true,
              startDate: true,
            },
          },
          course: {
            select: {
              id: true,
              title: true,
            },
          },
        },
      });

      // Create transaction record
      await tx.paymentTransaction.create({
        data: {
          paymentId: newPayment.id,
          reference,
          paystackReference: paystackResponse.data.reference,
          type: data.installmentPlan === "FULL_PAYMENT" ? "FULL_PAYMENT" : "FIRST_INSTALLMENT",
          amountKobo: amountToChargeKobo,
          status: "PENDING",
          ipAddress,
        },
      });

      // Create audit log
      await this.createAuditLog(
        newPayment.id,
        "PAYMENT_INITIATED",
        `Payment initiated for ${cohort.course.title} - ${data.installmentPlan}`,
        data.userId,
        "USER",
        {
          amount: MoneyUtils.formatNaira(amountToChargeKobo),
          plan: data.installmentPlan,
        },
        tx
      );

      return newPayment;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });

    logger.info(`Payment initiated: ${reference} for student ${data.studentId}`);

    return {
      payment,
      authorizationUrl: paystackResponse.data.authorization_url,
      accessCode: paystackResponse.data.access_code,
      reference,
      reused: false,
    };
  }

  //  VERIFY PAYMENT 
  
  static async verifyPayment(reference: string, webhookData?: any) {
    // Get payment
    const payment = await prisma.$transaction(async (tx:PrismaClient) => {
  return await tx.payment.findUnique({
    where: { reference },
    include: {
      student: {
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          },
        },
      },
      cohort: {
        select: {
          id: true,
          name: true,
          startDate: true,
        },
      },
      course: {
        select: {
          id: true,
          title: true,
        },
      },
    },
  });
}, {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
});

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    // If already completed -> return
    if (payment.status === "COMPLETED" && payment.balanceKobo === 0) {
      return payment;
    }

    //  Paystack verification
    const verification = webhookData || await this.callPaystack(`/transaction/verify/${payment.paystackReference}`, "GET");

    if (!verification.status || !verification.data) {
      throw new Error("Failed to verify payment");
    }

    const paystackData = verification.data;

    // Update payment in transaction
    const updatedPayment = await prisma.$transaction(async (tx:PrismaClient) => {
      // Check payment status from Paystack
      if (paystackData.status !== "success") {
        // Payment failed
        const failedPayment = await tx.payment.update({
  where: { id: payment.id },
  data: {
    status: "FAILED",
    lastCheckedAt: new Date(),
  },
  include: {
    student: {
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    },
    cohort: {
      select: {
        id: true,
        name: true,
        startDate: true,
      },
    },
    course: {
      select: {
        id: true,
        title: true,
      },
    },
  },
});

        // Update transaction
        await tx.paymentTransaction.updateMany({
          where: {
            paymentId: payment.id,
            status: "PENDING",
          },
          data: {
            status: "FAILED",
            failedAt: new Date(),
            gatewayResponse: JSON.parse(JSON.stringify(paystackData)),
            gatewayMessage: paystackData.gateway_response,
          },
        });

        await this.createAuditLog(
          payment.id,
          "PAYMENT_FAILED",
          `Payment verification failed: ${paystackData.gateway_response}`,
          undefined,
          "WEBHOOK",
          { gateway_response: paystackData.gateway_response },
          tx
        );

        return failedPayment;
      }

      // Payment successful
      const amountPaidKobo = paystackData.amount; 
      const isFullPayment = payment.installmentPlan === "FULL_PAYMENT";
      const isFirstInstallment = payment.installmentPlan  === "TWO_INSTALLMENTS" && !payment.firstInstallmentPaidAt;

      const newPaidAmount = payment.paidAmountKobo + amountPaidKobo;
      const newBalance = payment.totalAmountKobo - newPaidAmount;
      const isFullyPaid = newBalance === 0;

      const updateData: any = {
        paidAmountKobo: newPaidAmount,
        balanceKobo: newBalance,
        status: isFullyPaid ? "COMPLETED" : "PROCESSING",
        paymentMethod: paystackData.channel?.toUpperCase().replace("-", "_") as any,
        confirmedAt: isFullyPaid ? new Date() : payment.confirmedAt,
        lastCheckedAt: new Date(),
      };

      if (isFirstInstallment) {
        updateData.firstInstallmentPaidAt = new Date();
        updateData.firstInstallmentReference = payment.paystackReference;
      }

      const updatedPayment = await tx.payment.update({
  where: { id: payment.id },
  data: updateData,
  include: {
    student: {
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    },
    cohort: {
      select: {
        id: true,
        name: true,
        startDate: true,
      },
    },
    course: {
      select: {
        id: true,
        title: true,
      },
    },
  },
});

      // Update transaction record
      await tx.paymentTransaction.updateMany({
        where: {
          paymentId: payment.id,
          reference: payment.reference,
        },
        data: {
          status: "COMPLETED",
          completedAt: new Date(),
          paymentMethod: paystackData.channel?.toUpperCase().replace("-", "_") as any,
          gatewayResponse: JSON.parse(JSON.stringify(paystackData)),
          gatewayMessage: paystackData.gateway_response,
          channel: paystackData.channel,
        },
      });

      // If fully paid, enroll student
      if (isFullyPaid) {
        await tx.enrollment.create({
          data: {
            studentId: payment.studentId,
            courseId: payment.courseId,
            cohortId: payment.cohortId,
            status: "ACTIVE",
          },
        });

        await this.createAuditLog(
          payment.id,
          "PAYMENT_COMPLETED",
          `Payment completed and student enrolled in ${payment.course.title}`,
          undefined,
          "WEBHOOK",
          {
            amount_paid: MoneyUtils.formatNaira(amountPaidKobo),
            total_paid: MoneyUtils.formatNaira(newPaidAmount),
          },
          tx
        );

        logger.info(`Payment completed and student enrolled: ${payment.reference}`);
      } else {
        await this.createAuditLog(
          payment.id,
          "FIRST_INSTALLMENT_PAID",
          `First installment paid. Balance: ${MoneyUtils.formatNaira(newBalance)}`,
          undefined,
          "WEBHOOK",
          {
            amount_paid: MoneyUtils.formatNaira(amountPaidKobo),
            balance: MoneyUtils.formatNaira(newBalance),
            due_date: payment.secondInstallmentDueDate,
          },
          tx
        );

        logger.info(`First installment paid: ${payment.reference}. Balance: ${MoneyUtils.formatNaira(newBalance)}`);
      }

      return updatedPayment;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 10000,
      timeout: 15000,
    });

    return updatedPayment;
  }

  //  PAY SECOND INSTALLMENT 
  
  static async initiateSecondInstallment(paymentId: string, userId: string) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        student: {
          include: {
            user: true,
          },
        },
        cohort: true,
        course: true,
      },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    if (payment.userId !== userId) {
      throw new ForbiddenError("Unauthorized");
    }

    if (payment.installmentPlan !== "TWO_INSTALLMENTS") {
      throw new BadRequestError("This payment is not an installment plan");
    }

    if (!payment.firstInstallmentPaidAt) {
      throw new BadRequestError("First installment has not been paid yet");
    }

    if (payment.secondInstallmentPaidAt) {
      throw new BadRequestError("Second installment has already been paid");
    }

    if (payment.balanceKobo === 0) {
      throw new BadRequestError("Payment is already completed");
    }

    // Generate new reference for second installment
    const reference = this.generateReference("SEC");

    // Initialize Paystack for second installment
    const paystackPayload = {
      email: payment.student.user.email,
      amount: payment.secondInstallmentKobo!,
      reference,
      currency: "NGN",
      callback_url: `${process.env.FRONTEND_URL}/payment/callback`,
      metadata: {
        payment_id: payment.id,
        payment_reference: payment.reference,
        student_id: payment.studentId,
        cohort_id: payment.cohortId,
        installment_type: "SECOND",
      },
      channels: ["card", "bank", "ussd", "qr", "mobile_money", "bank_transfer"],
    };

    const paystackResponse = await this.callPaystack("/transaction/initialize", "POST", paystackPayload);

    // Create transaction record
    await prisma.$transaction(async (tx:PrismaClient) => {
      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          reference,
          paystackReference: paystackResponse.data.reference,
          type: "SECOND_INSTALLMENT",
          amountKobo: payment.secondInstallmentKobo!,
          status: "PENDING",
        },
      });

      await tx.payment.update({
        where: { id: payment.id },
        data: {
          secondInstallmentReference: paystackResponse.data.reference,
        },
      });

      await this.createAuditLog(
        payment.id,
        "SECOND_INSTALLMENT_INITIATED",
        `Second installment payment initiated`,
        userId,
        "USER",
        {
          amount: MoneyUtils.formatNaira(payment.secondInstallmentKobo!),
        },
        tx
      );
    });

    return {
      authorizationUrl: paystackResponse.data.authorization_url,
      accessCode: paystackResponse.data.access_code,
      reference,
      amount: MoneyUtils.formatNaira(payment.secondInstallmentKobo!),
    };
  }

  //  LIST PAYMENTS (ADMIN) 
  
  static async listPayments(filters: {
    status?: PaymentState;
    studentId?: string;
    cohortId?: string;
    courseId?: string;
    installmentPlan?: InstallmentPlan;
    startDate?: Date;
    endDate?: Date;
    page?: number;
    limit?: number;
  }) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (filters.status) where.status = filters.status;
    if (filters.studentId) where.studentId = filters.studentId;
    if (filters.cohortId) where.cohortId = filters.cohortId;
    if (filters.courseId) where.courseId = filters.courseId;
    if (filters.installmentPlan) where.installmentPlan = filters.installmentPlan;

    if (filters.startDate || filters.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          student: {
            select: {
              id: true,
              studentId: true,
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          cohort: {
            select: {
              id: true,
              name: true,
            },
          },
          course: {
            select: {
              id: true,
              title: true,
            },
          },
          _count: {
            select: {
              transactions: true,
              auditLogs: true,
            },
          },
        },
      }),
      prisma.payment.count({ where }),
    ]);

    // Format amounts for response
    const formattedPayments = payments.map((p:any) => ({
      ...p,
      totalAmount: MoneyUtils.formatNaira(p.totalAmountKobo),
      paidAmount: MoneyUtils.formatNaira(p.paidAmountKobo),
      balance: MoneyUtils.formatNaira(p.balanceKobo),
      firstInstallment: p.firstInstallmentKobo ? MoneyUtils.formatNaira(p.firstInstallmentKobo) : null,
      secondInstallment: p.secondInstallmentKobo ? MoneyUtils.formatNaira(p.secondInstallmentKobo) : null,
    }));

    return {
      data: formattedPayments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  //  GET PAYMENT DETAILS 
  
  static async getPaymentDetails(paymentId: string, userId?: string, isAdmin: boolean = false) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        student: {
          include: {
            user: true,
          },
        },
        cohort: {
          include: {
            course: true,
          },
        },
        course: true,
        transactions: {
          orderBy: { initiatedAt: "desc" },
        },
        auditLogs: {
          orderBy: { timestamp: "desc" },
          take: isAdmin ? undefined : 10,
        },
      },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    // Authorization check for non-admin
    if (!isAdmin && payment.userId !== userId) {
      throw new ForbiddenError("Unauthorized");
    }

    return {
      ...payment,
      totalAmount: MoneyUtils.formatNaira(payment.totalAmountKobo),
      paidAmount: MoneyUtils.formatNaira(payment.paidAmountKobo),
      balance: MoneyUtils.formatNaira(payment.balanceKobo),
      firstInstallment: payment.firstInstallmentKobo ? MoneyUtils.formatNaira(payment.firstInstallmentKobo) : null,
      secondInstallment: payment.secondInstallmentKobo ? MoneyUtils.formatNaira(payment.secondInstallmentKobo) : null,
      transactions: payment.transactions.map((t:any) => ({
        ...t,
        amount: MoneyUtils.formatNaira(t.amountKobo),
      })),
    };
  }

  //  UPDATE PAYMENT (ADMIN) 
  
  static async updatePaymentStatus(
    paymentId: string,
    adminId: string,
    newStatus: PaymentState,
    notes?: string
  ) {
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    const updatedPayment = await prisma.$transaction(async (tx:PrismaClient) => {
      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: newStatus,
          updatedAt: new Date(),
        },
      });

      await this.createAuditLog(
        paymentId,
        "ADMIN_STATUS_UPDATE",
        notes || `Payment status updated to ${newStatus}`,
        adminId,
        "ADMIN",
        {
          previous_status: payment.status,
          new_status: newStatus,
          notes,
        },
        tx
      );

      return updated;
    });

    logger.info(`Payment ${paymentId} status updated by admin ${adminId}: ${payment.status} → ${newStatus}`);

    return updatedPayment;
  }

  //  PAYMENT STATISTICS 
  
  static async getPaymentStatistics(filters?: {
    startDate?: Date;
    endDate?: Date;
    cohortId?: string;
    courseId?: string;
  }) {
    const where: any = {};

    if (filters?.startDate || filters?.endDate) {
      where.createdAt = {};
      if (filters.startDate) where.createdAt.gte = filters.startDate;
      if (filters.endDate) where.createdAt.lte = filters.endDate;
    }

    if (filters?.cohortId) where.cohortId = filters.cohortId;
    if (filters?.courseId) where.courseId = filters.courseId;

    const [
      totalPayments,
      completedPayments,
      pendingPayments,
      failedPayments,
      totalRevenue,
      installmentPayments,
    ] = await Promise.all([
      prisma.payment.count({ where }),
      prisma.payment.count({ where: { ...where, status: "COMPLETED" } }),
      prisma.payment.count({ where: { ...where, status: "PENDING" } }),
      prisma.payment.count({ where: { ...where, status: "FAILED" } }),
      prisma.payment.aggregate({
        where: { ...where, status: "COMPLETED" },
        _sum: { paidAmountKobo: true },
      }),
      prisma.payment.count({
        where: { ...where, installmentPlan: "TWO_INSTALLMENTS" },
      }),
    ]);

    return {
      totalPayments,
      completedPayments,
      pendingPayments,
      failedPayments,
      installmentPayments,
      totalRevenue: MoneyUtils.formatNaira(totalRevenue._sum.paidAmountKobo || 0),
      totalRevenueKobo: totalRevenue._sum.paidAmountKobo || 0,
    };
  }
}