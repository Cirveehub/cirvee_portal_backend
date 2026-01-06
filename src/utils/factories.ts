import prisma from "../config/database";
import { UserRole, CohortStatus, PaymentState, EnrollmentStatus } from "@prisma/client";
import bcrypt from "bcryptjs";

export const TestFactory = {
  /**
   * CREATE DEPARTMENT
   */
  async createDepartment(overrides: any = {}) {
    return prisma.department.create({
      data: {
        name: `Dept-${Math.random().toString(36).substring(7)}`,
        description: "Test Department Description",
        ...overrides,
      },
    });
  },

  /**
   * CREATE ADMIN USER 
   */
  async createAdmin(deptId?: string, overrides: any = {}) {
    const password = await bcrypt.hash("password123", 10);
    const email = `admin-${Math.random().toString(36).substring(7)}@test.com`;
    
    return prisma.user.create({
      data: {
        email,
        password,
        firstName: "Test",
        lastName: "Admin",
        role: UserRole.ADMIN,
        isActive: true,
        isEmailVerified: true,
        ...overrides,
        admin: {
          create: {
            staffId: `ADM-${Math.random().toString(36).substring(7).toUpperCase()}`,
            departmentId: deptId,
            permissions: ["ALL"],
            ...(overrides.admin || {}),
          },
        },
      },
      include: { admin: true },
    });
  },

  /**
   * CREATE TUTOR USER 
   */
  async createTutor(overrides: any = {}) {
    const password = await bcrypt.hash("password123", 10);
    const email = `tutor-${Math.random().toString(36).substring(7)}@test.com`;

    return prisma.user.create({
      data: {
        email,
        password,
        firstName: "Test",
        lastName: "Tutor",
        role: UserRole.TUTOR,
        isActive: true,
        isEmailVerified: true,
        ...overrides,
        tutor: {
          create: {
            staffId: `TUT-${Math.random().toString(36).substring(7).toUpperCase()}`,
            ...(overrides.tutor || {}),
          },
        },
      },
      include: { tutor: true },
    });
  },

  /**
   * CREATE STUDENT USER 
   */
  async createStudent(overrides: any = {}) {
    const password = await bcrypt.hash("password123", 10);
    const email = `student-${Math.random().toString(36).substring(7)}@test.com`;

    return prisma.user.create({
      data: {
        email,
        password,
        firstName: "Test",
        lastName: "Student",
        role: UserRole.STUDENT,
        isActive: true,
        isEmailVerified: true,
        ...overrides,
        student: {
          create: {
            studentId: `STD-${Math.random().toString(36).substring(7).toUpperCase()}`,
            ...(overrides.student || {}),
          },
        },
      },
      include: { student: true },
    });
  },

  /**
   * CREATE COURSE
   */
  async createCourse(adminId: string, overrides: any = {}) {
    return prisma.course.create({
      data: {
        title: `Course-${Math.random().toString(36).substring(7)}`,
        description: "Standard Test Course Description",
        syllabus: ["Topic A", "Topic B"],
        price: 20000, // stored in generic unit or handled primarily by payment
        duration: 8,
        createdById: adminId,
        isActive: true,
        ...overrides,
      },
    });
  },

  /**
   * CREATE COHORT
   */
  async createCohort(courseId: string, tutorId: string, adminId: string, overrides: any = {}) {
    return prisma.cohort.create({
      data: {
        name: `Cohort-${Math.random().toString(36).substring(7)}`,
        courseId,
        tutorId,
        createdById: adminId,
        startDate: new Date(),
        endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), 
        status: CohortStatus.UPCOMING,
        ...overrides,
      },
    });
  },

  /**
   * CREATE ENROLLMENT
   */
  async createEnrollment(studentId: string, courseId: string, cohortId: string, overrides: any = {}) {
    return prisma.enrollment.create({
        data: {
            studentId,
            courseId,
            cohortId,
            status: EnrollmentStatus.ACTIVE,
            ...overrides,
        }
    });
  },

  /**
   * CREATE ASSIGNMENT
   */
  async createAssignment(cohortId: string, tutorId: string, overrides: any = {}) {
      return prisma.assignment.create({
          data: {
              title: `Assignment ${Math.random().toString(36).substring(7)}`,
              description: "Test Assignment",
              dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 days
              totalMarks: 100,
              cohortId,
              tutorId,
              ...overrides
          }
      });
  },

  /**
   * CREATE PAYMENT
   */
  async createPayment(studentId: string, userId: string, courseId: string, cohortId: string, overrides: any = {}) {
      return prisma.payment.create({
          data: {
              reference: `PAY-${Math.random().toString(36).substring(7).toUpperCase()}`,
              idempotencyKey: `KEY-${Math.random().toString(36).substring(7)}`,
              studentId,
              userId,
              cohortId,
              courseId,
              totalAmountKobo: 500000,
              paidAmountKobo: 500000,
              balanceKobo: 0,
              status: PaymentState.COMPLETED,
              ...overrides
          }
      });
  },
  /**
   * CREATE TIMETABLE (using raw prisma create for now as specific scheduling can be complex, but good to have helper)
   */
  async createTimetable(cohortId: string, overrides: any = {}) {
      return prisma.timetable.create({
          data: {
              cohortId,
              dayOfWeek: "Monday",
              startTime: "09:00",
              endTime: "11:00",
              ...overrides
          }
      });
  },

  // TEST  GLOBAL CLEANUP 
  
  async clearDatabase() {
    const deleteAuditLogs = prisma.paymentAuditLog.deleteMany();
    const deleteTransactions = prisma.paymentTransaction.deleteMany(); 
    const deleteRefunds = prisma.paymentRefund.deleteMany();
    const deletePayments = prisma.payment.deleteMany();
    const deleteAssignments = prisma.assignment.deleteMany();
    const deleteEnrollments = prisma.enrollment.deleteMany();
    const deleteCohorts = prisma.cohort.deleteMany();
    const deleteCourses = prisma.course.deleteMany();
    const deleteAdmins = prisma.admin.deleteMany();
    const deleteTutors = prisma.tutor.deleteMany();
    const deleteStudents = prisma.student.deleteMany();
    const deleteTimetables = prisma.timetable.deleteMany();
    const deleteUsers = prisma.user.deleteMany();
    const deleteDepts = prisma.department.deleteMany();

    // Use transaction to cleanup
    // Note: order matters due to foreign key constraints, though deleteMany usually handles basic cases 
    // cascading deletes might need to be explicit or relied upon.
    // Ideally use cascade in schema, but here we can try to be safe.
    
    // We'll wrap in try-catch to avoid failing on individual table issues during dev
    try {
        await deleteAuditLogs;
        await deleteTransactions;
        await deleteRefunds;
        await deletePayments;
        await deleteAssignments;
        await deleteEnrollments;
        await deleteCohorts;
        await deleteCourses;
        await deleteAdmins;
        await deleteTutors;
        await deleteStudents;
        await deleteTimetables;
        await deleteUsers;
        await deleteDepts;
    } catch(e) {
        console.error("Cleanup failed", e);
    }
  }
};