import prisma from "@config/database";
import { uploadToCloudinary, removeFromCloudinary } from "../../utils/cloudinary";
import { Assignment, AssignmentSubmission } from "@prisma/client";
import { QueueService } from "../../services/queue.service";

export class AssignmentService {
  // Create a new assignment

  static async createAssignment(data: {
    cohortId: string;
    tutorId: string;
    title: string;
    description: string;
    dueDate: Date;
    totalMarks: number;
    attachments?: Express.Multer.File[];
  }): Promise<Assignment> {
    const attachmentUrls: string[] = [];

    if (data.attachments && data.attachments.length > 0) {
      for (const file of data.attachments) {
        const result = await uploadToCloudinary(file, `cohorts/${data.cohortId}/assignments`);
        attachmentUrls.push(result.secure_url);
        // TODO ->
        //  For assignments, we might want to store publicIds too if we need to delete specific attachments later.
        // For development storing the URLs in an array as per the current schema.
      }
    }

    const assignment = await prisma.assignment.create({
      data: {
        cohortId: data.cohortId,
        tutorId: data.tutorId,
        title: data.title,
        description: data.description,
        dueDate: data.dueDate,
        totalMarks: data.totalMarks,
        attachments: attachmentUrls,
      },
      include: {
        tutor: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              }
            }
          }
        },
        cohort: {
            select: {
                course: {
                    select: { title: true }
                }
            }
        }
      }
    });

    // Notify Students
    // Fetch all students in the cohort who are active
    const students = await prisma.enrollment.findMany({
        where: { 
            cohortId: data.cohortId,
            status: 'ACTIVE'
        },
        include: {
            student: {
                include: { user: true }
            }
        }
    });

    for (const enrollment of students) {
        const student = enrollment.student.user;
        await QueueService.addEmailJob({
            type: 'ASSIGNMENT_CREATED',
            payload: {
                email: student.email,
                studentName: student.firstName,
                assignmentTitle: assignment.title,
                courseTitle: assignment.cohort.course.title,
                dueDate: assignment.dueDate
            }
        });
    }

    return assignment;
  }

  // Submit an assignment
  static async submitAssignment(data: {
    assignmentId: string;
    studentId: string;
    file: Express.Multer.File;
  }): Promise<AssignmentSubmission> {
    const assignment = await prisma.assignment.findUnique({
      where: { id: data.assignmentId },
    });

    if (!assignment) {
      throw new Error("Assignment not found");
    }

    // Check if duplicate submission
    const existingSubmission = await prisma.assignmentSubmission.findUnique({
      where: {
        assignmentId_studentId: {
          assignmentId: data.assignmentId,
          studentId: data.studentId,
        },
      },
    });

    if (existingSubmission && existingSubmission.filePublicId) {
      await removeFromCloudinary(existingSubmission.filePublicId);
    }

    const result = await uploadToCloudinary(data.file, `assignments/${data.assignmentId}/submissions`);

    return prisma.assignmentSubmission.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId: data.assignmentId,
          studentId: data.studentId,
        },
      },
      update: {
        fileUrl: result.secure_url,
        filePublicId: result.public_id,
        submittedAt: new Date(),
        status: "SUBMITTED",
      },
      create: {
        assignmentId: data.assignmentId,
        studentId: data.studentId,
        fileUrl: result.secure_url,
        filePublicId: result.public_id,
      },
    });
  }

  // Grade a submission
  static async gradeSubmission(data: {
    submissionId: string;
    tutorId: string;
    grade: number;
    feedback?: string;
  }): Promise<AssignmentSubmission> {
    return prisma.assignmentSubmission.update({
      where: { id: data.submissionId },
      data: {
        grade: data.grade,
        feedback: data.feedback,
        status: "GRADED",
        gradedById: data.tutorId,
        gradedAt: new Date(),
      },
    });
  }

  // Get assignments for a cohort
  static async getCohortAssignments(cohortId: string): Promise<Assignment[]> {
    return prisma.assignment.findMany({
      where: { cohortId },
      include: {
        _count: {
          select: { submissions: true }
        }
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
