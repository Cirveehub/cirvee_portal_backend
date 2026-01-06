import { Router } from "express";
import { authenticate } from "../../middleware/auth.middleware";
import { requireRole } from "../../middleware/permission.middleware";
import { UserRole } from "@prisma/client";
import { StatsController } from "./stats.controller";

const router = Router();

// Student
router.get(
  "/student",
  authenticate,
  requireRole(UserRole.STUDENT),
  StatsController.getStudentStats
);

// Tutor
router.get(
  "/tutor",
  authenticate,
  requireRole(UserRole.TUTOR),
  StatsController.getTutorStats
);

// Admin Routes - All require ADMIN or SUPER_ADMIN
// Note: We need to spread the middleware array if using it like this, or just define it inline.
// But express router.get expects handlers.
const adminMiddleware = [authenticate, requireRole(UserRole.ADMIN, UserRole.SUPER_ADMIN)];

router.get("/admin/dashboard", ...adminMiddleware, StatsController.getAdminDashboardStats);
router.get("/admin/trends", ...adminMiddleware, StatsController.getAdminTrends);
router.get("/admin/distribution", ...adminMiddleware, StatsController.getAdminUserDistribution);
router.get("/admin/students", ...adminMiddleware, StatsController.getAdminStudentManagementStats);
router.get("/admin/financial", ...adminMiddleware, StatsController.getAdminFinancialStats);
router.get("/admin/academic", ...adminMiddleware, StatsController.getAdminAcademicStats);
router.get("/admin/staff", ...adminMiddleware, StatsController.getAdminStaffStats);

export default router;
