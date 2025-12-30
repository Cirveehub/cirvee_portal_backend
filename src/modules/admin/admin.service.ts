import bcrypt from "bcryptjs";
import crypto from "crypto";
import prisma from "@config/database";
import { IdGenerator } from "../../utils/idGenerator";
import { UserRole } from "@prisma/client";
import logger from "../../utils/logger";
import { QueueService } from "../../services/queue.service";

export class AdminService {
  private static generateRandomPassword(): string {
    return crypto.randomBytes(8).toString("hex");
  }

  // CREATE ADMIN
  static async createAdmin(data: {
    email: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    department?: string;
    permissions?: string[];
  }) {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) throw new Error("Email already registered");

    const staffId = await IdGenerator.generateAdminStaffId();
    const temporaryPassword = this.generateRandomPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 12);

    const role = data.permissions?.includes("SUPER_ADMIN")
      ? UserRole.SUPER_ADMIN
      : UserRole.ADMIN;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          firstName: data.firstName,
          lastName: data.lastName,
          phoneNumber: data.phoneNumber,
          role,
          isEmailVerified: true,
        },
      });

      const admin = await tx.admin.create({
        data: {
          userId: user.id,
          staffId,
          departmentId: data.department,
          permissions: data.permissions || [],
        },
      });

      return { user, admin };
    });

    await QueueService.addEmailJob({
      type: "STAFF_CREDENTIALS",
      payload: {
        email: data.email,
        name: data.firstName,
        staffId,
        password: temporaryPassword,
        role: "Administrator"
      }
    });

    logger.info(`Admin created and credentials sent: ${staffId}`);

    const { password: _, ...userWithoutPassword } = result.user;

    return {
      user: userWithoutPassword,
      admin: result.admin,
      staffId,
      email: data.email,
    };
  }

  // CREATE TUTOR
  static async createTutor(data: {
    email: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    courseCode: string;
    bio?: string;
    expertise?: string[];
    yearsOfExperience?: number;
  }) {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existingUser) throw new Error("Email already registered");

    const staffId = await IdGenerator.generateTutorStaffId(data.courseCode);
    const temporaryPassword = this.generateRandomPassword();
    const hashedPassword = await bcrypt.hash(temporaryPassword, 12);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          firstName: data.firstName,
          lastName: data.lastName,
          phoneNumber: data.phoneNumber,
          role: UserRole.TUTOR,
          isEmailVerified: true,
        },
      });

      const tutor = await tx.tutor.create({
        data: {
          userId: user.id,
          staffId,
          bio: data.bio,
          expertise: data.expertise || [],
          yearsOfExperience: data.yearsOfExperience,
        },
      });

      return { user, tutor };
    });

    // Send Email
    await QueueService.addEmailJob({
      type: "STAFF_CREDENTIALS",
      payload: {
        email: data.email,
        name: data.firstName,
        staffId,
        password: temporaryPassword,
        role: "Tutor"
      }
    });

    logger.info(`Tutor created and credentials sent: ${staffId}`);

    const { password: _, ...userWithoutPassword } = result.user;

    return {
      user: userWithoutPassword,
      tutor: result.tutor,
      staffId,
      email: data.email,
    };
  }

  // GET ALL ADMINS
  static async getAllAdmins(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [admins, total] = await Promise.all([
      prisma.admin.findMany({
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
              isActive: true,
              lastLogin: true,
              role: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.admin.count(),
    ]);

    return {
      admins,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // GET ALL TUTORS
  static async getAllTutors(page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;

    const [tutors, total] = await Promise.all([
      prisma.tutor.findMany({
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phoneNumber: true,
              isActive: true,
              lastLogin: true,
              role: true,
              createdAt: true,
            },
          },
          cohorts: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.tutor.count(),
    ]);

    return {
      tutors,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // UPDATE ADMIN
  static async updateAdmin(
    adminId: string,
    data: {
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
      department?: string;
      permissions?: string[];
    }
  ) {
    const admin = await prisma.admin.findUnique({
      where: { id: adminId },
      include: { user: true },
    });

    if (!admin) throw new Error("Admin not found");

    const result = await prisma.$transaction(async (tx) => {
      if (data.firstName || data.lastName || data.phoneNumber) {
        await tx.user.update({
          where: { id: admin.userId },
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            phoneNumber: data.phoneNumber,
          },
        });
      }

      const updatedAdmin = await tx.admin.update({
        where: { id: adminId },
        data: {
          departmentId: data.department,
          permissions: data.permissions,
        },
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              role: true,
              isActive: true,
            },
          },
        },
      });

      return updatedAdmin;
    });

    logger.info(`Admin updated: ${result.staffId}`);
    return result;
  }

  // DEACTIVATE USER
  static async deactivateUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: false },
    });

    logger.info(`User deactivated: ${user.email}`);
    return { message: "User deactivated successfully" };
  }

  // ACTIVATE USER
  static async activateUser(userId: string) {
    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: true },
    });

    logger.info(`User activated: ${user.email}`);
    return { message: "User activated successfully" };
  }
}