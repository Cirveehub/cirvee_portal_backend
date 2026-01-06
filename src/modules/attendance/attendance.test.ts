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
import { UserRole, AttendanceLogType, CohortStatus } from "@prisma/client";
import { TestFactory } from "../../utils/factories";

describe("Attendance Module (QR System)", () => {
  let adminToken: string;
  let adminId: string;
  let tutorId: string;
  let studentToken: string;
  let studentId: string;
  let testQRCodeId: string;
  let testToken: string;
  let cohortId: string;
  let courseId: string;
  let timetableId: string;

  beforeAll(async () => {
    await TestFactory.clearDatabase();
    
    // 1. Create Dual Role User (Admin + Tutor)
    // specific to this test which seems to require one user acting as both? 
    // Or maybe just convenience. Let's use Factory for Admin and append Tutor.
    const adminUser = await TestFactory.createAdmin(undefined, {
      role: UserRole.ADMIN, // prioritizing admin role on user
      admin: { permissions: ["*"] }
    });

    // Manually add Tutor profile to this admin user effectively making them dual role capable if logic permits
    // The test expects adminUser.tutor to exist.
    const tutorProfile = await prisma.tutor.create({
      data: {
        userId: adminUser.id,
        staffId: `ST-${Date.now()}`,
        expertise: ["Testing"],
        bio: "Test Bio"
      }
    });

    // Re-fetch to get embedded structure like test expects if needed, 
    // but we can just assign IDs since that's what is extracted.
    adminId = adminUser.admin!.id;
    tutorId = tutorProfile.id;
    adminToken = TokenUtil.generateAccessToken({ id: adminUser.id, email: adminUser.email, role: adminUser.role }); 

    // 2. Create Course
    const course = await TestFactory.createCourse(adminId, {
      title: "Test Attendance Course",
      price: 100
    });
    courseId = course.id;

    // 3. Create Student
    const studentUser = await TestFactory.createStudent();
    studentId = studentUser.student!.id;
    studentToken = TokenUtil.generateAccessToken({ id: studentUser.id, email: studentUser.email, role: UserRole.STUDENT });

    // 4. Create Cohort
    const cohort = await TestFactory.createCohort(course.id, tutorId, adminId, {
      name: "Test Cohort A",
      status: CohortStatus.ONGOING,
      startDate: new Date(),
      endDate: new Date(Date.now() + 86400000 * 30),
    });
    cohortId = cohort.id;

    // 5. Enroll Student
    await TestFactory.createEnrollment(studentId, course.id, cohortId);

    // 6. Create Timetable
    const currentDay = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const timetable = await TestFactory.createTimetable(cohortId, {
      dayOfWeek: currentDay,
      startTime: "00:00",
      endTime: "23:59"
    });
    timetableId = timetable.id;
  });

  afterAll(async () => {
    await TestFactory.clearDatabase();
  });

  describe("QR Code Generation", () => {
    it("should allow admin to generate a QR code with optional cohort linkage", async () => {
      const res = await request(app)
        .post("/api/v1/attendance/qr/generate")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ locationName: "Main Entrance", cohortId });

      expect(res.status).toBe(201);
      expect(res.body.data.locationName).toBe("Main Entrance");
      expect(res.body.data.cohortId).toBe(cohortId);

      testQRCodeId = res.body.data.id;
      testToken = res.body.data.token;
    });

    it("should not allow student to generate a QR code", async () => {
      const res = await request(app)
        .post("/api/v1/attendance/qr/generate")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({ locationName: "Forbidden Zone" });

      expect(res.status).toBe(403);
    });
  });

  describe("Integrated Scanning Logic", () => {
    it("should automatically resolve cohort and timetable during scan", async () => {
      // Create a general QR code (not tied to cohort)
      const genRes = await request(app)
        .post("/api/v1/attendance/qr/generate")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ locationName: "General Hall" });
      
      const genToken = genRes.body.data.token;

      const res = await request(app)
        .post("/api/v1/attendance/scan")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          token: genToken,
          type: AttendanceLogType.CHECK_IN
        });

      expect(res.status).toBe(200);
      expect(res.body.data.cohortId).toBe(cohortId);
      expect(res.body.data.timetableId).toBe(timetableId);
    });

    it("should correctly record check-out", async () => {
      const res = await request(app)
        .post("/api/v1/attendance/scan")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          token: testToken,
          type: AttendanceLogType.CHECK_OUT
        });

      expect(res.status).toBe(200);
      expect(res.body.data.type).toBe(AttendanceLogType.CHECK_OUT);
      expect(res.body.data.cohortId).toBe(cohortId);
    });
  });

  describe("Attendance Reporting", () => {
    it("should retrieve cohort statistics", async () => {
      const res = await request(app)
        .get(`/api/v1/attendance/cohort/${cohortId}/stats`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.cohortName).toBe("Test Cohort A");
      expect(res.body.data.attendancePercentage).toBe(100); // 1 student, hashed and seen
      expect(res.body.data.logs.length).toBeGreaterThanOrEqual(1);
    });

    it("should allow admin to filter logs by cohortId", async () => {
      const res = await request(app)
        .get("/api/v1/attendance/logs")
        .query({ cohortId })
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      res.body.data.forEach((log: any) => {
        expect(log.cohortId).toBe(cohortId);
      });
    });
  });
});
