import { PrismaClient, UserRole, CohortStatus, EnrollmentStatus, PaymentState } from "@prisma/client";
import prisma from "../../config/database";
import { startOfDay, endOfDay, subDays, format } from "date-fns";

export class StatsService {
  /**
   * Get dashboard stats for a Student
   */
  static async getStudentStats(userId: string, studentId: string) {
    // 1. Active Courses (Enrollments)
    const activeCourses = await prisma.enrollment.count({
      where: {
        studentId,
        status: EnrollmentStatus.ACTIVE,
      },
    });

    // 2. Pending Assignments (Due in the future)
    // Find cohorts the student is in
    const enrollments = await prisma.enrollment.findMany({
      where: { studentId, status: EnrollmentStatus.ACTIVE },
      select: { cohortId: true },
    });
    const cohortIds = enrollments.map((e) => e.cohortId);

    const pendingAssignments = await prisma.assignment.count({
      where: {
        cohortId: { in: cohortIds },
        dueDate: { gte: new Date() },
        // Exclude submitted ones? For simplicity, just count upcoming for now, 
        // or finer grained: where NO submission from this student
        submissions: {
          none: {
            studentId,
          }
        }
      },
    });

    // 3. Unread/New Announcements (Last 7 days)
    const recentAnnouncements = await prisma.announcement.count({
      where: {
        OR: [
          { isGlobal: true },
          { cohortId: { in: cohortIds } },
          { cohorts: { some: { cohortId: { in: cohortIds } } } }
        ],
        createdAt: { gte: subDays(new Date(), 7) },
      },
    });

    // 4. Recent Forum Messages (Last 7 days in joined communities)
    const recentForumMessages = await prisma.post.count({
      where: {
        community: {
          members: {
            some: { userId },
          },
        },
        createdAt: { gte: subDays(new Date(), 7) },
      },
    });

    return {
      activeCourses,
      pendingAssignments,
      unreadAnnouncements: recentAnnouncements, // Proxy for unread
      unreadMessages: recentForumMessages, // Proxy for unread
    };
  }

  /**
   * Get dashboard stats for a Tutor
   */
  static async getTutorStats(tutorId: string) {
    // 1. Today's Sessions
    // Get tutor's cohorts
    const cohorts = await prisma.cohort.findMany({
      where: { tutorId, status: CohortStatus.ONGOING },
      select: { id: true },
    });
    const cohortIds = cohorts.map((c) => c.id);

    // Get today's day name (e.g., "Monday")
    const today = format(new Date(), "EEEE"); 
    
    const todaysSessions = await prisma.timetable.count({
      where: {
        cohortId: { in: cohortIds },
        dayOfWeek: { equals: today, mode: "insensitive" },
      },
    });

    // 2. Grading Queue (Submissions pending grading for tutor's assignments)
    // Assignments created by this tutor OR just in tutor's cohorts
    const gradingQueue = await prisma.assignmentSubmission.count({
      where: {
        assignment: {
          tutorId, // Assignments created by this tutor
        },
        grade: null, // Not yet graded
        status: "SUBMITTED",
      },
    });

    // 3. Total Students (Unique enrollments in tutor's cohorts)
    const totalStudents = await prisma.enrollment.count({
      where: {
        cohortId: { in: cohortIds },
        status: EnrollmentStatus.ACTIVE,
      },
    });

    // 4. Performance (Average grade across all graded submissions)
    const aggregations = await prisma.assignmentSubmission.aggregate({
      where: {
        assignment: { tutorId },
        grade: { not: null },
      },
      _avg: {
        grade: true,
      },
    });

    // 5. Recent performance trend (Last 30 days) - simplified to just current avg
    // Could track change from last week if needed

    return {
      todaysSessions,
      gradingQueue,
      totalStudents,
      performance: Math.round(aggregations._avg.grade || 0),
    };
  }

  /**
   * Get main Admin Dashboard Stats
   */
  static async getAdminDashboardStats() {
    const totalStaff = await prisma.user.count({
      where: {
        role: { in: [UserRole.ADMIN, UserRole.TUTOR, UserRole.SUPER_ADMIN] },
        isActive: true,
      },
    });

    const totalStudents = await prisma.student.count();

    const activeCohorts = await prisma.cohort.count({
      where: { status: CohortStatus.ONGOING },
    });

    const today = format(new Date(), "EEEE");
    const todaysClasses = await prisma.timetable.count({
      where: {
        dayOfWeek: { equals: today, mode: "insensitive" },
        cohort: { status: CohortStatus.ONGOING },
      },
    });

    return {
      totalStaff,
      totalStudents,
      activeCohorts,
      todaysClasses,
    };
  }

  /**
   * Get Admin User Distribution (Pie Chart)
   */
  static async getAdminUserDistribution() {
    const students = await prisma.user.count({ where: { role: UserRole.STUDENT } });
    const tutors = await prisma.user.count({ where: { role: UserRole.TUTOR } });
    const admins = await prisma.user.count({ where: { role: { in: [UserRole.ADMIN, UserRole.SUPER_ADMIN] } } });

    return {
      students,
      tutors,
      admins,
      total: students + tutors + admins
    };
  }

  /**
   * Get Admin Trends (Graph data - e.g. Login activity or Enrollments last 6 months)
   * Doing Enrollment counts by month for now
   */
  static async getAdminTrends() {
    // This usually requires raw SQL for efficient grouping by date
    // Or we fetch last 6 months enrollments and process in JS
    
    const sixMonthsAgo = subDays(new Date(), 180);
    const enrollments = await prisma.enrollment.findMany({
      where: { enrollmentDate: { gte: sixMonthsAgo } },
      select: { enrollmentDate: true },
    });

    // Group by month-year
    const trendMap = new Map<string, number>();
    enrollments.forEach(e => {
        const key = format(e.enrollmentDate, "MMM yyyy");
        trendMap.set(key, (trendMap.get(key) || 0) + 1);
    });

    // Format for frontend
    const trends = Array.from(trendMap.entries()).map(([date, count]) => ({ date, count }));
    return trends;
  }

  /**
   * Get Student Management Stats (Account Statuses)
   */
  static async getAdminStudentManagementStats() {
    const total = await prisma.student.count();
    const activeUsers = await prisma.user.count({
        where: { role: UserRole.STUDENT, isActive: true }
    });
    const inactiveUsers = await prisma.user.count({
        where: { role: UserRole.STUDENT, isActive: false }
    });
    
    // Check payment issues (students with pending payments)
    // This is a rough proxy: students who have PENDING payments
    const paymentIssues = await prisma.payment.groupBy({
        by: ['studentId'],
        where: {
            status: { in: [PaymentState.PENDING, PaymentState.FAILED] }
        }
    });

    return {
        totalStudents: total,
        activeAccounts: activeUsers,
        lockedAccounts: inactiveUsers,
        paymentIssues: paymentIssues.length
    };
  }

  /**
   * Get Financial Stats for Admin
   */
  static async getAdminFinancialStats() {
    const totalRevenueAgg = await prisma.payment.aggregate({
        where: { status: PaymentState.COMPLETED },
        _sum: { paidAmountKobo: true }
    });
    const totalRevenue = (totalRevenueAgg._sum.paidAmountKobo || 0) / 100; // to Naira/Base

    const pendingAgg = await prisma.payment.aggregate({
        where: { status: PaymentState.PENDING },
        _sum: { totalAmountKobo: true }
    });
    const pendingAmount = (pendingAgg._sum.totalAmountKobo || 0) / 100;

    const recentTransactions = await prisma.paymentTransaction.findMany({
        take: 5,
        orderBy: { initiatedAt: 'desc' },
        include: {
            payment: {
                select: {
                    user: { select: { firstName: true, lastName: true, email: true } },
                    reference: true
                }
            }
        }
    });

    return {
        totalRevenue,
        pendingAmount,
        recentTransactions
    };
  }

  /**
   * Get Academic Stats for Admin
   */
  static async getAdminAcademicStats() {
    const totalCourses = await prisma.course.count();
    const totalCohorts = await prisma.cohort.count();
    
    const topCourses = await prisma.enrollment.groupBy({
        by: ['courseId'],
        _count: {
            studentId: true
        },
        orderBy: {
            _count: {
                studentId: 'desc'
            }
        },
        take: 5
    });

    // Populate course names
    const populatedTopCourses = await Promise.all(topCourses.map(async (item) => {
        const course = await prisma.course.findUnique({ where: { id: item.courseId } });
        return {
            courseTitle: course?.title,
            students: item._count.studentId
        };
    }));

    // Average attendance rate (Global)
    // present / total logs
    const totalAttendance = await prisma.attendance.count();
    const presentAttendance = await prisma.attendance.count({ where: { status: 'PRESENT' } });
    const attendanceRate = totalAttendance > 0 ? Math.round((presentAttendance / totalAttendance) * 100) : 0;

    return {
        totalCourses,
        totalCohorts,
        attendanceRate,
        topCourses: populatedTopCourses
    };
  }

  /**
   * Get Staff Stats for Admin
   */
  static async getAdminStaffStats() {
      const totalTutors = await prisma.tutor.count();
      const totalAdmins = await prisma.admin.count();
      
      return {
          totalTutors,
          totalAdmins,
          totalStaff: totalTutors + totalAdmins
      };
  }
}
