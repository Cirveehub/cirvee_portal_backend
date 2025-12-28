import prisma from "@config/database";
import logger from "../../utils/logger";
import { CohortStatus } from "@prisma/client";

export class CourseService {

  //  CALCULATE STATUS
    static calculateCohortStatus(startDate: Date, endDate: Date): CohortStatus {
      const now = new Date();
      
      if (now < startDate) {
        return CohortStatus.UPCOMING;
      } else if (now >= startDate && now <= endDate) {
        return CohortStatus.ONGOING;
      } else {
        return CohortStatus.COMPLETED;
      }
    }
  
    //  CALCULATE PROGRESS
    static calculateProgress(startDate: Date, endDate: Date): number {
      const now = new Date();
      const start = startDate.getTime();
      const end = endDate.getTime();
      const current = now.getTime();
  
      if (current < start) {
        return 0;
      } else if (current > end) {
        return 100;
      } else {
        const progress = ((current - start) / (end - start)) * 100;
        return Math.round(progress * 100) / 100; // 2 decimal places
      }
    }
  // CREATE COURSE 
  static async createCourse(data: {
    title: string;
    description: string;
    syllabus: string[];
    coverImage?: string;
    category?: string;
    price: number;
    duration: number;
    createdById: string;
  }) {
    const course = await prisma.course.create({
      data: {
        title: data.title,
        description: data.description,
        syllabus: data.syllabus,
        coverImage: data.coverImage,
        category: data.category,
        price: data.price,
        duration: data.duration,
        createdById: data.createdById,
        isActive: true,
      },
      include: {
        createdBy: {
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
      },
    });

    logger.info(`Course created: ${course.title} by ${data.createdById}`);
    return course;
  }

  // UPDATE COURSE 
  static async updateCourse(
    courseId: string,
    data: {
      title?: string;
      description?: string;
      syllabus?: string[];
      coverImage?: string;
      category?: string;
      price?: number;
      duration?: number;
    }
  ) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: {
        title: data.title,
        description: data.description,
        syllabus: data.syllabus,
        coverImage: data.coverImage,
        category: data.category,
        price: data.price,
        duration: data.duration,
      },
      include: {
        createdBy: {
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
      },
    });

    logger.info(`Course updated: ${courseId}`);
    return updated;
  }

  // ACTIVATE COURSE 
  static async activateCourse(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { isActive: true },
    });

    logger.info(`Course activated: ${courseId}`);
    return { message: "Course activated successfully", course: updated };
  }

  // DEACTIVATE COURSE 
  static async deactivateCourse(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    const updated = await prisma.course.update({
      where: { id: courseId },
      data: { isActive: false },
    });

    logger.info(`Course deactivated: ${courseId}`);
    return { message: "Course deactivated successfully", course: updated };
  }

  // GET ALL COURSES 
  static async getAllCourses(
    page: number = 1,
    limit: number = 10,
    filters?: {
      isActive?: boolean;
      category?: string;
    }
  ) {
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }
    if (filters?.category) {
      where.category = filters.category;
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        skip,
        take: limit,
        include: {
          createdBy: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                },
              },
            },
          },
          _count: {
            select: {
              cohorts: true,
              enrollments: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.course.count({ where }),
    ]);

    return {
      courses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // GET PUBLIC COURSES 
  static async getPublicCourses(
    page: number = 1,
    limit: number = 10,
    category?: string
  ) {
    const skip = (page - 1) * limit;

    const where: any = { isActive: true };
    if (category) {
      where.category = category;
    }

    const [courses, total] = await Promise.all([
      prisma.course.findMany({
        where,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          description: true,
          coverImage: true,
          category: true,
          price: true,
          duration: true,
          _count: {
            select: {
              enrollments: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
      prisma.course.count({ where }),
    ]);

    return {
      courses,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // GET COURSE BY ID 
  static async getCourseById(courseId: string) {
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      include: {
        createdBy: {
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
        cohorts: {
          select: {
            id: true,
            name: true,
            startDate: true,
            endDate: true,
            status: true,
            tutor: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
            _count: {
              select: {
                enrollments: true,
              },
            },
          },
        },
        _count: {
          select: {
            enrollments: true,
          },
        },
      },
    });

    if (!course) {
      throw new Error("Course not found");
    }

    return course;
  }

   // GET COHORTS BY COURSE
    static async getCohortsByCourse(
      courseId: string,
      page: number = 1,
      limit: number = 10
    ) {
      const skip = (page - 1) * limit;
  
      const [cohorts, total] = await Promise.all([
        prisma.cohort.findMany({
          where: { courseId },
          skip,
          take: limit,
          include: {
            tutor: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
            _count: {
              select: {
                enrollments: true,
              },
            },
          },
          orderBy: {
            startDate: "desc",
          },
        }),
        prisma.cohort.count({ where: { courseId } }),
      ]);
  
      // Add calculated fields
      const cohortsWithCalculations = cohorts.map((cohort:any) => ({
        ...cohort,
        calculatedStatus: this.calculateCohortStatus(
          cohort.startDate,
          cohort.endDate
        ),
        progressPercentage: this.calculateProgress(
          cohort.startDate,
          cohort.endDate
        ),
      }));
  
      return {
        cohorts: cohortsWithCalculations,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
}
