import prisma from "@config/database";
import { Prisma } from "@prisma/client";
import { ForbiddenError, NotFoundError } from "@utils/httpErrors";
import logger from "@utils/logger";
import { QueueService } from "../../services/queue.service";

type StaffRole = "SUPER_ADMIN" | "ADMIN" | "TUTOR";

export class AnnouncementService {
  
  private static isStaff(role: string): role is StaffRole {
    return ["SUPER_ADMIN", "ADMIN", "TUTOR"].includes(role);
  }

  private static async getStudentId(userId: string): Promise<string | null> {
    const student = await prisma.student.findUnique({
      where: { userId },
      select: { id: true },
    });
    return student?.id || null;
  }

  private static async getStaffRecord(userId: string, role: StaffRole) {
    if (role === "TUTOR") {
      const tutor = await prisma.tutor.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!tutor) throw new NotFoundError("Tutor record not found");
      return { tutorId: tutor.id, adminId: null };
    }

    const admin = await prisma.admin.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!admin) throw new NotFoundError("Admin record not found");
    return { adminId: admin.id, tutorId: null };
  }

  private static async buildAccessFilter(
    userId: string,
    role: string
  ): Promise<Prisma.AnnouncementWhereInput> {
    if (this.isStaff(role)) return {};

    const studentId = await this.getStudentId(userId);
    if (!studentId) return { isGlobal: true };

    return {
      OR: [
        { isGlobal: true },
        {
          cohorts: {
            some: {
              cohort: {
                enrollments: {
                  some: { studentId },
                },
              },
            },
          },
        },
      ],
    };
  }

  private static getAnnouncementInclude(userId: string) {
    return {
      admin: {
        select: {
          id: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
        },
      },
      tutor: {
        select: {
          id: true,
          user: {
            select: {
              firstName: true,
              lastName: true,
              profileImage: true,
            },
          },
        },
      },
      cohorts: {
        select: {
          cohort: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
      _count: {
        select: { likes: true },
      },
      likes: {
        where: { userId },
        select: { id: true },
      },
    };
  }


  // LIST ALL
  static async listAll(userId: string, role: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = await this.buildAccessFilter(userId, role);

    const [announcements, total] = await Promise.all([
      prisma.announcement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: this.getAnnouncementInclude(userId),
      }),
      prisma.announcement.count({ where }),
    ]);

    logger.info(`Listed ${announcements.length} announcements for user ${userId}`);

    return {
      data: announcements,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // GET BY ID
  static async getById(id: string, userId: string, role: string) {
    const where = await this.buildAccessFilter(userId, role);

    const announcement = await prisma.announcement.findFirst({
      where: { id, ...where },
      include: this.getAnnouncementInclude(userId),
    });

    if (!announcement) {
      throw new NotFoundError("Announcement not found or access denied");
    }

    logger.info(`User ${userId} accessed announcement ${id}`);
    return announcement;
  }

  // CREATE
  static async createAnnouncement(
    userId: string,
    role: string,
    data: {
      title: string;
      content: string;
      isGlobal: boolean;
      cohortIds?: string[];
    }
  ) {
    if (!this.isStaff(role)) {
      throw new ForbiddenError("Only staff can create announcements");
    }

    const { adminId, tutorId } = await this.getStaffRecord(userId, role as StaffRole);

    const announcement = await prisma.$transaction(async (tx) => {
      const newAnnouncement = await tx.announcement.create({
        data: {
          title: data.title.trim(),
          content: data.content.trim(),
          isGlobal: data.isGlobal,
          createdById: userId,
          createdByType: role,
          adminId,
          tutorId,
        },
        include: this.getAnnouncementInclude(userId),
      });

      if (data.cohortIds && data.cohortIds.length > 0) {
        await tx.announcementCohort.createMany({
          data: data.cohortIds.map((cohortId) => ({
            announcementId: newAnnouncement.id,
            cohortId,
          })),
        });
      }

      return newAnnouncement;
    });

    logger.info(
      `Announcement '${announcement.title}' created by ${role} ${userId} | ` +
      `Global: ${data.isGlobal} | Cohorts: ${data.cohortIds?.length || 0}`
    );

    // Send Email Notification
    // 1. Identify Recipients
    let recipientIds: string[] = [];

    if (data.isGlobal) {
        // Warning: This could be large. Ideally use a bulk job or separate worker process.
        // For now, fetching all active students.
        const students = await prisma.user.findMany({
            where: { role: 'STUDENT', isActive: true },
            select: { id: true, email: true, firstName: true }
        });
        
        for (const student of students) {
             await QueueService.addEmailJob({
                type: 'ANNOUNCEMENT_NEW',
                payload: {
                    email: student.email,
                    name: student.firstName,
                    title: announcement.title,
                    content: announcement.content,
                    senderName: role === 'ADMIN' || role === 'SUPER_ADMIN' ? 'Admin' : 'Tutor' // Or fetch specific name
                }
            });
        }
    } else if (data.cohortIds && data.cohortIds.length > 0) {
        // Fetch students in these cohorts
        const enrollments = await prisma.enrollment.findMany({
            where: {
                cohortId: { in: data.cohortIds },
                status: 'ACTIVE'
            },
            include: {
                student: { include: { user: true } }
            },
            distinct: ['studentId'] // Prevent duplicates if student is in multiple cohorts (unlikely but safe)
        });

        for (const enrollment of enrollments) {
            const student = enrollment.student.user;
            await QueueService.addEmailJob({
                type: 'ANNOUNCEMENT_NEW',
                payload: {
                    email: student.email,
                    name: student.firstName,
                    title: announcement.title,
                    content: announcement.content,
                    senderName: role === 'ADMIN' || role === 'SUPER_ADMIN' ? 'Admin' : 'Tutor'
                }
            });
        }
    }

    return announcement;
  }

  // UPDATE
  static async updateAnnouncement(
    announcementId: string,
    userId: string,
    role: string,
    data: {
      title?: string;
      content?: string;
      isGlobal?: boolean;
      cohortIds?: string[];
    }
  ) {
    const announcement = await prisma.announcement.findUnique({
      where: { id: announcementId },
    });

    if (!announcement) {
      throw new NotFoundError("Announcement not found");
    }

    const isCreator = announcement.createdById === userId;
    const isSuperAdmin = role === "SUPER_ADMIN";

    if (!isCreator && !isSuperAdmin) {
      throw new ForbiddenError("Only the creator or super admin can edit this announcement");
    }

    const updatedAnnouncement = await prisma.$transaction(async (tx) => {
      const updated = await tx.announcement.update({
        where: { id: announcementId },
        data: {
          ...(data.title && { title: data.title.trim() }),
          ...(data.content && { content: data.content.trim() }),
          ...(data.isGlobal !== undefined && { isGlobal: data.isGlobal }),
        },
        include: this.getAnnouncementInclude(userId),
      });

      if (data.cohortIds !== undefined) {
        await tx.announcementCohort.deleteMany({
          where: { announcementId },
        });

        if (data.cohortIds.length > 0) {
          await tx.announcementCohort.createMany({
            data: data.cohortIds.map((cohortId) => ({
              announcementId,
              cohortId,
            })),
          });
        }
      }

      return updated;
    });

    logger.info(`Announcement ${announcementId} updated by user ${userId}`);
    return updatedAnnouncement;
  }

  // DELETE
  static async deleteAnnouncement(announcementId: string, userId: string, role: string) {
    const announcement = await prisma.announcement.findUnique({
      where: { id: announcementId },
      include: { _count: { select: { likes: true } } },
    });

    if (!announcement) {
      throw new NotFoundError("Announcement not found");
    }

    const isCreator = announcement.createdById === userId;
    const isSuperAdmin = role === "SUPER_ADMIN";

    if (!isCreator && !isSuperAdmin) {
      throw new ForbiddenError("Only the creator or super admin can delete this announcement");
    }

    await prisma.announcement.delete({
      where: { id: announcementId },
    });

    logger.info(
      `Announcement '${announcement.title}' (${announcementId}) deleted by ${userId} | ` +
      `Had ${announcement._count.likes} likes`
    );

    return {
      message: "Announcement deleted successfully",
      deletedData: {
        likes: announcement._count.likes,
      },
    };
  }

  // TOGGLE LIKE
  static async toggleLike(announcementId: string, userId: string, role: string) {
    const where = await this.buildAccessFilter(userId, role);
    const announcement = await prisma.announcement.findFirst({
      where: { id: announcementId, ...where },
      select: { id: true },
    });

    if (!announcement) {
      throw new NotFoundError("Announcement not found or access denied");
    }

    return await prisma.$transaction(async (tx) => {
      const existing = await tx.announcementLike.findUnique({
        where: {
          announcementId_userId: { announcementId, userId },
        },
      });

      if (existing) {
        await tx.announcementLike.delete({ where: { id: existing.id } });
        logger.info(`Announcement ${announcementId} unliked by ${userId}`);
        return { liked: false };
      }

      await tx.announcementLike.create({
        data: { announcementId, userId },
      });
      logger.info(`Announcement ${announcementId} liked by ${userId}`);
      return { liked: true };
    });
  }
}