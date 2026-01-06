
// Mock Redis before importing app
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

import request from "supertest";
import app from "../../app";
import prisma from "@config/database";
import { TokenUtil } from "../../utils/token";
import { CohortStatus, UserRole } from "@prisma/client";
import { TestFactory } from "../../utils/factories";

describe("Course Module Endpoints", () => {
  let adminToken: string;
  let adminUserId: string;
  let adminId: string;
  let studentToken: string;
  let studentUserId: string;
  let testCourseId: string;
  let testDeptId: string;
  let testTutorId: string;

  beforeAll(async () => {
    await TestFactory.clearDatabase();

    // 1. Create a test department
    const dept = await TestFactory.createDepartment({
      name: `Test-Dept-Course-${Date.now()}`,
      description: "Test department for course tests",
    });
    testDeptId = dept.id;

    // 2. Create an Admin User
    const adminUser = await TestFactory.createAdmin(testDeptId, {
        email: `admin-course-${Date.now()}@test.com`,
        admin: {
            staffId: `STAFF-${Date.now()}`,
            permissions: ["CREATE_COURSE", "UPDATE_COURSE", "DELETE_COURSE"],
        }
    });

    adminUserId = adminUser.id;
    adminId = adminUser.admin!.id;
    adminToken = TokenUtil.generateAccessToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    // 3. Create a Student User
    const studentUser = await TestFactory.createStudent({
        email: `student-course-${Date.now()}@test.com`,
    });
    studentUserId = studentUser.id;
    studentToken = TokenUtil.generateAccessToken({
      id: studentUser.id,
      email: studentUser.email,
      role: studentUser.role,
    });

    // 4. Create a Tutor User
    const tutorUser = await TestFactory.createTutor({
        email: `tutor-course-${Date.now()}@test.com`,
        tutor: { staffId: `TUTOR-${Date.now()}` }
    });
    testTutorId = tutorUser.tutor!.id;
  });

  afterAll(async () => {
    await TestFactory.clearDatabase();
  });

  describe("POST /api/v1/courses", () => {
    it("should allow admin to create a course", async () => {
      const res = await request(app)
        .post("/api/v1/courses")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Test Course",
          description: "Test Description",
          syllabus: ["Topic 1", "Topic 2"],
          category: "Technology",
          price: 100,
          duration: 4,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.title).toBe("Test Course");
      testCourseId = res.body.data.id;
    });

    it("should not allow student to create a course", async () => {
      const res = await request(app)
        .post("/api/v1/courses")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          title: "Illegal Course",
          description: "Should fail",
          syllabus: ["None"],
          price: 50,
          duration: 2,
        });

      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/courses/:id", () => {
    it("should return course details", async () => {
      const res = await request(app)
        .get(`/api/v1/courses/${testCourseId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(testCourseId);
    });
  });

  describe("PATCH /api/v1/courses/:id/deactivate", () => {
    it("should allow admin to deactivate a course", async () => {
      const res = await request(app)
        .patch(`/api/v1/courses/${testCourseId}/deactivate`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isActive).toBe(false);
    });
  });

  describe("GET /api/v1/courses/public", () => {
    it("should only return active courses in public view", async () => {
      const res = await request(app)
        .get("/api/v1/courses/public");

      expect(res.status).toBe(200);
      const isTestCoursePresent = res.body.data.courses.some((c: any) => c.id === testCourseId);
      expect(isTestCoursePresent).toBe(false); // Since we deactivated it
    });
  });

  describe("GET /api/v1/courses/:id/cohorts", () => {
    it("should return all cohorts for a specific course", async () => {
      // 1. First, create a cohort for this course
      // 1. First, create a cohort for this course
      await TestFactory.createCohort(testCourseId, testTutorId, adminId, {
          name: "Test Cohort 1",
          status: CohortStatus.UPCOMING
      });

      // 2. Now fetch it
      const res = await request(app)
        .get(`/api/v1/courses/${testCourseId}/cohorts`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.cohorts)).toBe(true);
      expect(res.body.data.cohorts.length).toBeGreaterThan(0);
      expect(res.body.data.cohorts[0].name).toBe("Test Cohort 1");
    });
  });
});
