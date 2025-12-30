import { Request, Response, NextFunction } from "express";
import { PaymentService } from "./payment.service";
// import { AuthRequest } from "@middleware/auth.middleware";
import prisma from "@config/database";
import logger from "@utils/logger";
import { InstallmentPlan, PaymentState } from "@prisma/client";
import { AuthRequest } from "../../types";
import { ResponseUtil } from "@utils/response";

export class PaymentController {
  
  // STUDENT ENDPOINTS
  
  // Initiate payment for cohort enrollment
   
  static async initiatePayment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const { cohortId, fullName, phoneNumber, installmentPlan, metadata, amount } = req.body;

      // Get student record
      const student = await prisma.student.findUnique({
        where: { userId },
        select: { id: true, studentId: true },
      });

      if (!student) {
        return ResponseUtil.badRequest(
          res,
        );
      }

      // Get user email
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
      });

      // Get IP address
      const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0] || 
                       req.socket.remoteAddress || 
                       req.ip;

      const result = await PaymentService.initiatePayment({
        studentId: student.id,
        userId,
        cohortId,
        fullName,
        email: user!.email,
        phoneNumber,
        installmentPlan: installmentPlan as InstallmentPlan,
        metadata,
        amount: Number(amount),
      }, ipAddress);

      logger.info(`Payment initiated by student ${student.studentId}: ${result.reference}`);

      return ResponseUtil.success(
        res,
        "Payment initiated successfully. Please complete payment using the provided link.",
        {
          paymentId: result.payment.id,
          reference: result.reference,
          authorizationUrl: result.authorizationUrl,
          accessCode: result.accessCode,
          expiresAt: result.payment.expiresAt,
          amount: result.payment.installmentPlan === "FULL_PAYMENT"
            ? `₦${(result.payment.totalAmountKobo / 100).toLocaleString()}`
            : `₦${(result.payment.firstInstallmentKobo! / 100).toLocaleString()}`,
          installmentPlan: result.payment.installmentPlan,
          paymentBreakdown: result.payment.installmentPlan === "TWO_INSTALLMENTS" ? {
            firstInstallment: `₦${(result.payment.firstInstallmentKobo! / 100).toLocaleString()}`,
            secondInstallment: `₦${(result.payment.secondInstallmentKobo! / 100).toLocaleString()}`,
            secondInstallmentDueDate: result.payment.secondInstallmentDueDate,
          } : null,
        },
      );
    } catch (error: any) {
      logger.error(`Payment initiation error: ${error.message}`, { error, userId: req.user?.id });
      // next(error);
      return ResponseUtil.error(
        res,
        error.message || "Payment initiation failed",
        error.statusCode || 500
      );
    }
  }

  // Verify payment after Paystack callback 
   
  static async verifyPayment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { reference } = req.query;

      if (!reference || typeof reference !== "string") {
        return ResponseUtil.badRequest(
          res,
          "Payment reference is required",
        );
      }

      const payment = await PaymentService.verifyPayment(reference);

      return ResponseUtil.success(
        res,
        payment.status === "COMPLETED" 
          ? "Payment verified and completed successfully! You are now enrolled." 
          : payment.status === "PROCESSING"
          ? "First installment received. Please pay the second installment to complete enrollment."
          : "Payment verification completed.",
        {
          id: payment.id,
          reference: payment.reference,
          status: payment.status,
          totalAmount: `₦${(payment.totalAmountKobo / 100).toLocaleString()}`,
          paidAmount: `₦${(payment.paidAmountKobo / 100).toLocaleString()}`,
          balance: `₦${(payment.balanceKobo / 100).toLocaleString()}`,
          installmentPlan: payment.installmentPlan,
          confirmedAt: payment.confirmedAt,
          student: {
            name: `${payment.student.user.firstName} ${payment.student.user.lastName}`,
            studentId: payment.student.studentId,
          },
          course: {
            id: payment.course.id,
            title: payment.course.title,
          },
          cohort: {
            id: payment.cohort.id,
            name: payment.cohort.name,
            startDate: payment.cohort.startDate,
          },
        },
      );
    } catch (error: any) {
      logger.error(`Payment verification error: ${error.message}`, { error });
      return ResponseUtil.error(
        res,
        error.message || "Payment verification failed",
        error.statusCode || 500
      );
    }
  }

  // student payment history
  
  static async getMyPayments(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      // Get student ID
      const student = await prisma.student.findUnique({
        where: { userId },
        select: { id: true },
      });

      if (!student) {
        return ResponseUtil.badRequest(
          res,
          "Student record not found",
        );
      }

      const result = await PaymentService.listPayments({
        studentId: student.id,
        page,
        limit,
      });

      return ResponseUtil.paginated(
        res,
        "Payments retrieved successfully",
        result.data,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total,
        // result.pagination,
      );
    } catch (error: any) {
      logger.error(`Get my payments error: ${error.message}`, { error, userId: req.user?.id });
      return ResponseUtil.error(
        res,
        error.message || "Failed to retrieve payments",
        error.statusCode || 500
      );
    }
  }

  // Get payment details
  
  static async getPaymentDetails(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const payment = await PaymentService.getPaymentDetails(id, userId, false);

      return ResponseUtil.success(
        res,
        "Payment details retrieved successfully",
        payment,
      );
    } catch (error: any) {
      logger.error(`Get payment details error: ${error.message}`, { error });
      return ResponseUtil.error(
        res,
        error.message || "Failed to retrieve payment details",
        error.statusCode || 500
      );
    }
  }

  // Initiate second installment payment
  
  static async paySecondInstallment(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const result = await PaymentService.initiateSecondInstallment(id, userId);

      return ResponseUtil.success(
        res,
        "Second installment payment initiated successfully",
        result,
      );
    } catch (error: any) {
      logger.error(`Second installment initiation error: ${error.message}`, { error });
      // next(error);
      return ResponseUtil.error(
        res,
        error.message || "Failed to initiate second installment payment",
        error.statusCode || 500
      );
    }
  }

  // ADMIN ENDPOINTS

  // List all payments (Admin only) & finance when we add te department
  static async listAllPayments(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const {
        status,
        studentId,
        cohortId,
        courseId,
        installmentPlan,
        startDate,
        endDate,
        page,
        limit,
      } = req.query;

      const filters: any = {
        page: page ? parseInt(page as string) : undefined,
        limit: limit ? parseInt(limit as string) : undefined,
      };

      if (status) filters.status = status as PaymentState;
      if (studentId) filters.studentId = studentId as string;
      if (cohortId) filters.cohortId = cohortId as string;
      if (courseId) filters.courseId = courseId as string;
      if (installmentPlan) filters.installmentPlan = installmentPlan as InstallmentPlan;
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);

      const result = await PaymentService.listPayments(filters);

      return ResponseUtil.paginated(
        res,
        "Payments retrieved successfully",
        result.data,
        result.pagination.page,
        result.pagination.limit,
        result.pagination.total,
      );
    } catch (error: any) {
      logger.error(`List all payments error: ${error.message}`, { error });
      return ResponseUtil.error(
        res,
        error.message || "Failed to list payments",
        error.statusCode || 500
      );
    }
  }

  // Get payment details 
  
  static async getPaymentDetailsAdmin(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;

      const payment = await PaymentService.getPaymentDetails(id, undefined, true);

      return ResponseUtil.success(
        res,
        "Payment details retrieved successfully",
        payment,
      );
    } catch (error: any) {
      logger.error(`Get payment details admin error: ${error.message}`, { error });
      return ResponseUtil.error(
        res,
        error.message || "Failed to retrieve payment details",
        error.statusCode || 500
      );
    }
  }

  // Update payment status (Admin)
  
  static async updatePaymentStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const { status, notes } = req.body;
      const adminId = req.user!.id;

      const payment = await PaymentService.updatePaymentStatus(
        id,
        adminId,
        status as PaymentState,
        notes
      );

      return ResponseUtil.success(
        res,
        "Payment status updated successfully",
        payment,
      );
    } catch (error: any) {
      logger.error(`Update payment status error: ${error.message}`, { error });
      return ResponseUtil.error(
        res,
        error.message || "Failed to update payment status",
        error.statusCode || 500
      );
    }
  }

  // Get payment statistics (Admin)
  
  static async getPaymentStatistics(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { startDate, endDate, cohortId, courseId } = req.query;

      const filters: any = {};
      if (startDate) filters.startDate = new Date(startDate as string);
      if (endDate) filters.endDate = new Date(endDate as string);
      if (cohortId) filters.cohortId = cohortId as string;
      if (courseId) filters.courseId = courseId as string;

      const stats = await PaymentService.getPaymentStatistics(filters);

      return ResponseUtil.success(
        res,
        "Payment statistics retrieved successfully",
        stats,
      );
    } catch (error: any) {
      logger.error(`Get payment statistics error: ${error.message}`, { error });
      return ResponseUtil.error(
        res,
        error.message || "Failed to retrieve payment statistics",
        error.statusCode || 500
      );
    }
  }
}