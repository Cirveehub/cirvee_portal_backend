import { Response } from "express";
import { AuthRequest } from "../../types";
import { ResponseUtil } from "../../utils/response";
import { StatsService } from "./stats.service";
import logger from "../../utils/logger";

export class StatsController {
  
  static async getStudentStats(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.student) {
        return ResponseUtil.forbidden(res, "User is not a student");
      }
      
      const stats = await StatsService.getStudentStats(req.user.id, req.user.student.id);
      ResponseUtil.success(res, "Student stats retrieved", stats);
    } catch (error: any) {
      logger.error("Get Student Stats Error:", error);
      ResponseUtil.internalError(res, "Failed to retrieve student stats");
    }
  }

  static async getTutorStats(req: AuthRequest, res: Response) {
    try {
      if (!req.user?.tutor) {
        return ResponseUtil.forbidden(res, "User is not a tutor");
      }

      const stats = await StatsService.getTutorStats(req.user.tutor.id);
      ResponseUtil.success(res, "Tutor stats retrieved", stats);
    } catch (error: any) {
      logger.error("Get Tutor Stats Error:", error);
      ResponseUtil.internalError(res, "Failed to retrieve tutor stats");
    }
  }

  static async getAdminDashboardStats(req: AuthRequest, res: Response) {
    try {
      // Role check is handled by middleware but good to be safe/explicit if needed, 
      // though typically we trust the route middleware
      
      const stats = await StatsService.getAdminDashboardStats();
      ResponseUtil.success(res, "Admin dashboard stats retrieved", stats);
    } catch (error: any) {
        logger.error("Get Admin Dashboard Stats Error:", error);
        ResponseUtil.internalError(res, "Failed to retrieve admin dashboard stats");
    }
  }

  static async getAdminTrends(req: AuthRequest, res: Response) {
      try {
          const stats = await StatsService.getAdminTrends();
          ResponseUtil.success(res, "Admin trends retrieved", stats);
      } catch (error: any) {
          logger.error("Get Admin Trends Error:", error);
          ResponseUtil.internalError(res, "Failed to retrieve admin trends");
      }
  }

  static async getAdminUserDistribution(req: AuthRequest, res: Response) {
      try {
          const stats = await StatsService.getAdminUserDistribution();
          ResponseUtil.success(res, "User distribution retrieved", stats);
      } catch (error: any) {
          logger.error("Get User Distribution Error:", error);
          ResponseUtil.internalError(res, "Failed to retrieve user distribution");
      }
  }

  static async getAdminStudentManagementStats(req: AuthRequest, res: Response) {
      try {
          const stats = await StatsService.getAdminStudentManagementStats();
          ResponseUtil.success(res, "Student management stats retrieved", stats);
      } catch (error: any) {
          logger.error("Get Student Management Stats Error:", error);
          ResponseUtil.internalError(res, "Failed to retrieve student management stats");
      }
  }

    static async getAdminFinancialStats(req: AuthRequest, res: Response) {
      try {
          const stats = await StatsService.getAdminFinancialStats();
          ResponseUtil.success(res, "Financial stats retrieved", stats);
      } catch (error: any) {
          logger.error("Get Financial Stats Error:", error);
          ResponseUtil.internalError(res, "Failed to retrieve financial stats");
      }
  }

    static async getAdminAcademicStats(req: AuthRequest, res: Response) {
      try {
          const stats = await StatsService.getAdminAcademicStats();
          ResponseUtil.success(res, "Academic stats retrieved", stats);
      } catch (error: any) {
          logger.error("Get Academic Stats Error:", error);
          ResponseUtil.internalError(res, "Failed to retrieve academic stats");
      }
  }

    static async getAdminStaffStats(req: AuthRequest, res: Response) {
      try {
          const stats = await StatsService.getAdminStaffStats();
          ResponseUtil.success(res, "Staff stats retrieved", stats);
      } catch (error: any) {
          logger.error("Get Staff Stats Error:", error);
          ResponseUtil.internalError(res, "Failed to retrieve staff stats");
      }
  }
}
