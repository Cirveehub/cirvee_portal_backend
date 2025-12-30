import { Router } from "express";
import { PaymentController } from "./payment.controller";
import { authenticate } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/permission.middleware";
import { validateRequest } from "../../middleware/validation.middleware";
import { UserRole } from "@prisma/client";
import { body, param, query } from "express-validator";
import rateLimit from "express-rate-limit";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Payments
 *     description: Payment processing and management
 */

// RATE LIMITERS

const paymentInitiateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === "test" ? 1000 : 5, // Max 5 payment initiations per 15 minutes (relaxed for tests)
  message: "Too many payment attempts, please try again later",
});

const paymentVerifyLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: process.env.NODE_ENV === "test" ? 1000 : 30,
  message: "Too many verification requests, please try again late",
});

// STUDENT ROUTES

/**
 * @swagger
 * /api/v1/payments/initiate:
 *   post:
 *     summary: Initiate payment for cohort enrollment
 *     description: Student initiates payment. Can choose full payment or 2 installments (minimum 50% first installment)
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - cohortId
 *               - fullName
 *               - installmentPlan
 *             properties:
 *               cohortId:
 *                 type: string
 *                 format: uuid
 *                 description: ID of the cohort to enroll in
 *               fullName:
 *                 type: string
 *                 description: Student's full name
 *                 example: "Tobi Loba"
 *               phoneNumber:
 *                 type: string
 *                 description: Contact phone number
 *                 example: "+2348012345678"
 *               amount:
 *                 type: integer
 *                 description: Amount in Naira (e.g., 5000 for 5000 Naira). Required for FULL_PAYMENT if not full cost, or for INSTALLMENTS.
 *                 example: 5000
 *               installmentPlan:
 *                 type: string
 *                 enum: [FULL_PAYMENT, TWO_INSTALLMENTS]
 *                 description: Payment plan (FULL_PAYMENT or TWO_INSTALLMENTS)
 *     responses:
 *       201:
 *         description: Payment initiated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     paymentId:
 *                       type: string
 *                     reference:
 *                       type: string
 *                     authorizationUrl:
 *                       type: string
 *                     accessCode:
 *                       type: string
 *                     expiresAt:
 *                       type: string
 *                       format: date-time
 *       400:
 *         description: Bad request - validation error or already enrolled
 *       401:
 *         description: Unauthorized - Only students can make payments
 *       404:
 *         description: Cohort or student record not found
 *       429:
 *         description: Too many payment attempts
 */
router.post(
  "/initiate",
  authenticate as any,
  requireRole(UserRole.STUDENT) as any,
  paymentInitiateLimiter,
  [
    body("cohortId").isUUID().withMessage("Valid cohort ID is required"),
    body("fullName")
      .trim()
      .notEmpty()
      .withMessage("Full name is required")
      .isLength({ min: 3 })
      .withMessage("Full name must be at least 3 characters"),
    body("phoneNumber")
      .optional()
      .matches(/^\+?[1-9]\d{1,14}$/)
      .withMessage("Invalid phone number format"),
    body("installmentPlan")
      .isIn(["FULL_PAYMENT", "TWO_INSTALLMENTS"])
      .withMessage("Invalid installment plan"),
  ],
  validateRequest,
  PaymentController.initiatePayment as any
);

/**
 * @swagger
 * /api/v1/payments/verify:
 *   get:
 *     summary: Verify payment status
 *     description: Verify payment after Paystack redirect/callback
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: reference
 *         required: true
 *         schema:
 *           type: string
 *         description: Payment reference from initiation
 *     responses:
 *       200:
 *         description: Payment verified successfully
 *       400:
 *         description: Invalid reference
 *       404:
 *         description: Payment not found
 */
router.get(
  "/verify",
  authenticate as any,
  paymentVerifyLimiter,
  [
    query("reference").notEmpty().withMessage("Payment reference is required"),
  ],
  validateRequest,
  PaymentController.verifyPayment as any
);

/**
 * @swagger
 * /api/v1/payments/my-payments:
 *   get:
 *     summary: Get my payment history
 *     description: Student retrieves their payment history
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *     responses:
 *       200:
 *         description: Payments retrieved successfully
 *       401:
 *         description: Unauthorized
 */
router.get(
  "/my-payments",
  authenticate as any,
  requireRole(UserRole.STUDENT) as any,
  [
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  ],
  validateRequest,
  PaymentController.getMyPayments as any
);

/**
 * @swagger
 * /api/v1/payments/{id}:
 *   get:
 *     summary: Get payment details
 *     description: Get detailed information about a specific payment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Payment details retrieved
 *       403:
 *         description: Unauthorized access
 *       404:
 *         description: Payment not found
 */
router.get(
  "/:id",
  authenticate as any,
  [param("id").isUUID().withMessage("Invalid payment ID")],
  validateRequest,
  PaymentController.getPaymentDetails as any
);

/**
 * @swagger
 * /api/v1/payments/{id}/pay-second-installment:
 *   post:
 *     summary: Pay second installment
 *     description: Initiate payment for the second installment
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Payment ID
 *     responses:
 *       200:
 *         description: Second installment initiated
 *       400:
 *         description: Invalid request or first installment not paid
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Payment not found
 */
router.post(
  "/:id/pay-second-installment",
  authenticate as any,
  requireRole(UserRole.STUDENT) as any,
  paymentInitiateLimiter,
  [param("id").isUUID().withMessage("Invalid payment ID")],
  validateRequest,
  PaymentController.paySecondInstallment as any
);

// ADMIN ROUTES

/**
 * @swagger
 * /api/v1/payments/admin/all:
 *   get:
 *     summary: List all payments (Admin only)
 *     description: Get paginated list of all payments with filters
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [PENDING, PROCESSING, COMPLETED, FAILED, REFUNDED, CANCELLED, EXPIRED]
 *       - in: query
 *         name: cohortId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: courseId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: installmentPlan
 *         schema:
 *           type: string
 *           enum: [FULL_PAYMENT, TWO_INSTALLMENTS]
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Payments retrieved successfully
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden - Admin access required
 */
router.get(
  "/admin/all",
  authenticate as any,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN) as any,
  [
    query("page").optional().isInt({ min: 1 }).toInt(),
    query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
    query("status").optional().isIn(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED", "CANCELLED", "EXPIRED"]),
    query("cohortId").optional().isUUID(),
    query("courseId").optional().isUUID(),
    query("installmentPlan").optional().isIn(["FULL_PAYMENT", "TWO_INSTALLMENTS"]),
    query("startDate").optional().isISO8601(),
    query("endDate").optional().isISO8601(),
  ],
  validateRequest,
  PaymentController.listAllPayments as any
);

/**
 * @swagger
 * /api/v1/payments/admin/statistics:
 *   get:
 *     summary: Get payment statistics (Admin)
 *     description: Get payment analytics and statistics
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: cohortId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: courseId
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *       403:
 *         description: Forbidden
 */
router.get(
  "/admin/statistics",
  authenticate as any,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN) as any,
  [
    query("startDate").optional().isISO8601(),
    query("endDate").optional().isISO8601(),
    query("cohortId").optional().isUUID(),
    query("courseId").optional().isUUID(),
  ],
  validateRequest,
  PaymentController.getPaymentStatistics as any
);

/**
 * @swagger
 * /api/v1/payments/admin/{id}:
 *   get:
 *     summary: Get payment details (Admin)
 *     description: Get full payment details including audit logs
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Payment details retrieved
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Payment not found
 */
router.get(
  "/admin/:id",
  authenticate as any,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN) as any,
  [param("id").isUUID().withMessage("Invalid payment ID")],
  validateRequest,
  PaymentController.getPaymentDetailsAdmin as any
);

/**
 * @swagger
 * /api/v1/payments/admin/{id}/update-status:
 *   patch:
 *     summary: Update payment status (Admin)
 *     description: Manually update payment status with notes
 *     tags: [Payments]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [PENDING, PROCESSING, COMPLETED, FAILED, REFUNDED, CANCELLED, EXPIRED]
 *               notes:
 *                 type: string
 *                 description: Reason for status change
 *     responses:
 *       200:
 *         description: Payment status updated
 *       400:
 *         description: Invalid status
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Payment not found
 */
router.patch(
  "/admin/:id/update-status",
  authenticate as any,
  requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN) as any,
  [
    param("id").isUUID().withMessage("Invalid payment ID"),
    body("status")
      .isIn(["PENDING", "PROCESSING", "COMPLETED", "FAILED", "REFUNDED", "CANCELLED", "EXPIRED"])
      .withMessage("Invalid payment status"),
    body("notes").optional().isString().withMessage("Notes must be a string"),
  ],
  validateRequest,
  PaymentController.updatePaymentStatus as any
);



export default router;