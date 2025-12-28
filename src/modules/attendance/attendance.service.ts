import prisma from "@config/database";
import { AttendanceLog, AttendanceQRCode, AttendanceLogType, UserRole } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

export class AttendanceService {
  // Generate a new QR code 
  static async generateQRCode(adminId: string, locationName: string, cohortId?: string): Promise<AttendanceQRCode> {
    const token = uuidv4();

    return prisma.attendanceQRCode.create({
      data: {
        token,
        locationName,
        cohortId,
        createdById: adminId,
      },
    });
  }

  //Process a QR code scan for check-in or check-out
   
  static async processScan(userId: string, token: string, type: AttendanceLogType): Promise<AttendanceLog> {
    const qrCode = await prisma.attendanceQRCode.findUnique({
      where: { token },
      include: { cohort: true },
    });

    if (!qrCode || !qrCode.isActive) {
      throw new Error("Invalid or inactive QR code");
    }

    // Resolve Cohort and Timetable Session
    let resolvedCohortId = qrCode.cohortId;
    let resolvedTimetableId: string | undefined;

    const now = new Date();
    const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();

    // Find the user's role and relevant cohorts
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { student: true, tutor: true },
    });

    if (!resolvedCohortId) {
      // If QR is general, find active cohort sessions for the user
      const cohorts = await prisma.cohort.findMany({
        where: {
          OR: [
            { tutor: { userId } },
            { enrollments: { some: { student: { userId } } } }
          ],
          timetables: {
            some: { dayOfWeek: currentDay }
          }
        },
        include: {
          timetables: {
            where: { dayOfWeek: currentDay }
          }
        }
      });

      // Find a timetable entry that matches the current time (with 30 min grace period)
      for (const cohort of cohorts) {
        for (const tt of cohort.timetables) {
          const [startH, startM] = tt.startTime.split(':').map(Number);
          const [endH, endM] = tt.endTime.split(':').map(Number);
          const startMin = startH * 60 + startM - 30; // 30 min early
          const endMin = endH * 60 + endM + 30; // 30 min late

          if (currentTimeMinutes >= startMin && currentTimeMinutes <= endMin) {
            resolvedCohortId = cohort.id;
            resolvedTimetableId = tt.id;
            break;
          }
        }
        if (resolvedCohortId) break;
      }
    } else {
       // If QR is session specific, still try to find the timetable entry
       const timetable = await prisma.timetable.findFirst({
         where: {
           cohortId: resolvedCohortId,
           dayOfWeek: currentDay
         }
       });
       // Just check if it's roughly the same time
       if (timetable) {
         const [startH, startM] = timetable.startTime.split(':').map(Number);
         const startMin = startH * 60 + startM - 60;
         const endMin = startH * 60 + startM + 180; // 3 hour window for specific QR
         if (currentTimeMinutes >= startMin && currentTimeMinutes <= endMin) {
           resolvedTimetableId = timetable.id;
         }
       }
    }

    return prisma.attendanceLog.create({
      data: {
        userId,
        qrCodeId: qrCode.id,
        cohortId: resolvedCohortId,
        timetableId: resolvedTimetableId,
        type,
        locationName: qrCode.locationName,
      },
      include: {
        qrCode: true,
        cohort: { select: { name: true } },
        timetable: true
      },
    });
  }

  // Get attendance logs 
   
  static async getLogs(filters: {
    userId?: string;
    cohortId?: string;
    locationName?: string;
    startDate?: Date;
    endDate?: Date;
  }): Promise<AttendanceLog[]> {
    const where: any = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.cohortId) where.cohortId = filters.cohortId;
    if (filters.locationName) where.locationName = { contains: filters.locationName, mode: 'insensitive' };
    
    if (filters.startDate || filters.endDate) {
      where.timestamp = {};
      if (filters.startDate) where.timestamp.gte = filters.startDate;
      if (filters.endDate) where.timestamp.lte = filters.endDate;
    }

    return prisma.attendanceLog.findMany({
      where,
      include: {
        user: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
        qrCode: true,
        cohort: { select: { id: true, name: true } },
        timetable: true
      },
      orderBy: { timestamp: "desc" },
    });
  }

  
   
  static async getCohortStats(cohortId: string) {
    const cohort = await prisma.cohort.findUnique({
      where: { id: cohortId },
      include: {
        enrollments: { include: { student: { include: { user: true } } } },
        timetables: true
      }
    });

    if (!cohort) throw new Error("Cohort not found");

    const logs = await prisma.attendanceLog.findMany({
      where: { cohortId },
      select: { userId: true, timestamp: true, type: true, timetableId: true }
    });

    //  Calculate attendance percentage
    const totalStudents = cohort.enrollments.length;
    const studentsWithLogs = new Set(logs.map((l:any) => l.userId)).size;
    const attendancePercentage = totalStudents > 0 ? (studentsWithLogs / totalStudents) * 100 : 0;

    return {
      cohortName: cohort.name,
      attendancePercentage: Math.round(attendancePercentage),
      totalStudents,
      logs
    };
  }

  static async getMyLogs(userId: string): Promise<AttendanceLog[]> {
    return prisma.attendanceLog.findMany({
      where: { userId },
      include: { qrCode: true, cohort: { select: { name: true } } },
      orderBy: { timestamp: "desc" },
    });
  }

  static async deactivateQRCode(qrCodeId: string): Promise<AttendanceQRCode> {
    return prisma.attendanceQRCode.update({
      where: { id: qrCodeId },
      data: { isActive: false },
    });
  }

  static async regenerateQRCode(adminId: string, qrCodeId: string): Promise<AttendanceQRCode> {
    const oldQR = await this.deactivateQRCode(qrCodeId);
    return this.generateQRCode(adminId, oldQR.locationName, oldQR.cohortId || undefined);
  }
}
