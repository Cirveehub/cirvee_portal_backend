
jest.mock("../../config/redis", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    quit: jest.fn(),
    on: jest.fn(),
  },
  testRedis: jest.fn().mockResolvedValue(true),
}));

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: jest.fn(),
    close: jest.fn(),
    on: jest.fn(),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    close: jest.fn(),
    on: jest.fn(),
  })),
}));

jest.mock("../../utils/cloudinary", () => ({
  uploadToCloudinary: jest.fn().mockResolvedValue({
    secure_url: "https://cloudinary.com/test-file.pdf",
    public_id: "test-public-id",
  }),
  removeFromCloudinary: jest.fn().mockResolvedValue({ result: "ok" }),
}));

import request from "supertest";
import app from "../../app";
import prisma from "@config/database";
import { TokenUtil } from "../../utils/token";
import { UserRole } from "@prisma/client";
import { TestFactory } from "../../utils/factories";
import path from "path";

describe("Academic Module (Materials & Assignments)", () => {
  let adminToken: string;
  let adminId: string;
  let tutorToken: string;
  let tutorId: string;
  let studentToken: string;
  let studentId: string;
  let testDeptId: string;
  let testCourseId: string;
  let testCohortId: string;
  let testMaterialId: string;
  let testAssignmentId: string;

  beforeAll(async () => {
    await TestFactory.clearDatabase();

    const dept = await TestFactory.createDepartment({
      name: `Acad-Dept-${Date.now()}`
    });
    testDeptId = dept.id;

    const admin = await TestFactory.createAdmin(testDeptId, {
        email: `admin-acad-${Date.now()}@test.com`,
        admin: {
            staffId: `S-${Date.now()}`,
            permissions: ["*"]
        }
    });

    adminId = admin.admin!.id;
    adminToken = TokenUtil.generateAccessToken({ id: admin.id, email: admin.email, role: admin.role });

    const tutor = await TestFactory.createTutor({
        email: `tutor-acad-${Date.now()}@test.com`,
        tutor: { staffId: `T-${Date.now()}` }
    });
    tutorId = tutor.tutor!.id;
    tutorToken = TokenUtil.generateAccessToken({ id: tutor.id, email: tutor.email, role: tutor.role });

    const student = await TestFactory.createStudent({
        email: `student-acad-${Date.now()}@test.com`,
        student: { studentId: `ST-${Date.now()}` }
    });
    studentId = student.student!.id;
    studentToken = TokenUtil.generateAccessToken({ id: student.id, email: student.email, role: student.role });

    const course = await TestFactory.createCourse(adminId, {
        title: "Test Acad Course",
        price: 10,
        duration: 1,
    });
    testCourseId = course.id;

    const cohort = await TestFactory.createCohort(testCourseId, tutorId, adminId, {
        name: "Test Acad Cohort",
        startDate: new Date(),
        endDate: new Date(Date.now() + 86400000),
    });
    testCohortId = cohort.id;
  });

  afterAll(async () => {
    await TestFactory.clearDatabase();
  });

  describe("Materials", () => {
    it("should allow tutor to add a material", async () => {
      const res = await request(app)
        .post(`/api/v1/academic/cohorts/${testCohortId}/materials`)
        .set("Authorization", `Bearer ${tutorToken}`)
        .field("title", "Lecture 1")
        .field("type", "document")
        .attach("file", Buffer.from("test content"), "lecture.pdf");

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("Lecture 1");
      expect(res.body.data.url).toBeDefined();
      testMaterialId = res.body.data.id;
    });

    it("should allow students to view materials", async () => {
      const res = await request(app)
        .get(`/api/v1/academic/cohorts/${testCohortId}/materials`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("should allow tutor to delete material", async () => {
        const res = await request(app)
          .delete(`/api/v1/academic/materials/${testMaterialId}`)
          .set("Authorization", `Bearer ${tutorToken}`);
  
        expect(res.status).toBe(200);
      });
  });

  describe("Assignments", () => {
    it("should allow tutor to create an assignment", async () => {
      const res = await request(app)
        .post("/api/v1/academic/assignments")
        .set("Authorization", `Bearer ${tutorToken}`)
        .field("cohortId", testCohortId)
        .field("title", "Final Project")
        .field("description", "Do something great")
        .field("dueDate", new Date(Date.now() + 86400000).toISOString())
        .field("totalMarks", 100);

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe("Final Project");
      testAssignmentId = res.body.data.id;
    });

    it("should allow student to submit an assignment", async () => {
      const res = await request(app)
        .post(`/api/v1/academic/assignments/${testAssignmentId}/submit`)
        .set("Authorization", `Bearer ${studentToken}`)
        .attach("file", Buffer.from("submission content"), "project.zip");

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("SUBMITTED");
      expect(res.body.data.studentId).toBe(studentId);
    });

    it("should allow tutor to grade a submission", async () => {
        const submission = await prisma.assignmentSubmission.findFirst({
            where: { assignmentId: testAssignmentId, studentId: studentId }
        });

        const res = await request(app)
          .patch(`/api/v1/academic/submissions/${submission!.id}/grade`)
          .set("Authorization", `Bearer ${tutorToken}`)
          .send({ grade: 85, feedback: "Good effort" });
  
        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("GRADED");
        expect(res.body.data.grade).toBe(85);
      });
  });
});
