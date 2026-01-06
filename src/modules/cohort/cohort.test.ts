
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
import { UserRole } from "@prisma/client";
import { TestFactory } from "../../utils/factories";

describe("Cohort Module Endpoints", () => {
  let adminToken: string;
  let adminUserId: string;
  let adminId: string;
  let tutorToken: string;
  let tutorUserId: string;
  let tutorId: string;
  let studentToken: string;
  let studentUserId: string;
  let testCourseId: string;
  let testCohortId: string;
  let testDeptId: string;
  let testTimetableId: string;

  beforeAll(async () => {
    await TestFactory.clearDatabase();

    // 1. Create a test department
    const dept = await TestFactory.createDepartment({
      name: `Test-Dept-Cohort-${Date.now()}`,
      description: "Test department for cohort tests",
    });
    testDeptId = dept.id;

    // 2. Create an Admin User
    const adminUser = await TestFactory.createAdmin(testDeptId, {
        email: `admin-cohort-${Date.now()}@test.com`,
        admin: {
            staffId: `STAFF-ADMIN-${Date.now()}`,
            permissions: ["CREATE_COHORT", "ASSIGN_TUTOR"],
        }
    });

    adminUserId = adminUser.id;
    adminId = adminUser.admin!.id;
    adminToken = TokenUtil.generateAccessToken({
      id: adminUser.id,
      email: adminUser.email,
      role: adminUser.role,
    });

    // 3. Create a Tutor User
    const tutorUser = await TestFactory.createTutor({
        email: `tutor-cohort-${Date.now()}@test.com`,
        tutor: {
            staffId: `STAFF-TUTOR-${Date.now()}`,
            expertise: ["Testing"],
        }
    });

    tutorUserId = tutorUser.id;
    tutorId = tutorUser.tutor!.id;
    tutorToken = TokenUtil.generateAccessToken({
      id: tutorUser.id,
      email: tutorUser.email,
      role: tutorUser.role,
    });

    // 4. Create a Student User
    const studentUser = await TestFactory.createStudent({
        email: `student-cohort-${Date.now()}@test.com`,
    });
    studentUserId = studentUser.id;
    studentToken = TokenUtil.generateAccessToken({
      id: studentUser.id,
      email: studentUser.email,
      role: studentUser.role,
    });

    // 5. Create a Course (required for cohort)
    const course = await TestFactory.createCourse(adminUserId, {
        title: "Cohort dependency course",
        description: "Required for cohort",
        syllabus: ["Topic 1"],
        price: 50,
        duration: 2,
    });
    testCourseId = course.id;

    // 6. Create a Cohort for shared use
    const cohort = await TestFactory.createCohort(testCourseId, tutorId, adminUserId, {
        name: "Initial Test Cohort",
        startDate: new Date(Date.now() + 86400000),
        endDate: new Date(Date.now() + 86400000 * 30),
        status: "UPCOMING",
    });
    testCohortId = cohort.id;
  });

  afterAll(async () => {
    await TestFactory.clearDatabase();
  });

  describe("POST /api/v1/cohorts", () => {
    it("should allow admin to create a cohort", async () => {
      const res = await request(app)
        .post("/api/v1/cohorts")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          courseId: testCourseId,
          tutorId: tutorId,
          name: "Test Cohort Alpha",
          startDate: new Date(Date.now() + 86400000).toISOString(), // Tomorrow
          endDate: new Date(Date.now() + 86400000 * 30).toISOString(), // 30 days later
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe("Test Cohort Alpha");
      testCohortId = res.body.data.id;
    });

    it("should validate that end date is after start date", async () => {
        const res = await request(app)
          .post("/api/v1/cohorts")
          .set("Authorization", `Bearer ${adminToken}`)
          .send({
            courseId: testCourseId,
            tutorId: tutorId,
            name: "Invalid Dates Cohort",
            startDate: new Date(Date.now() + 86400000).toISOString(),
            endDate: new Date(Date.now()).toISOString(), // Before start date
          });
  
        expect(res.status).toBe(400);
      });
  });

  describe("GET /api/v1/cohorts/:id", () => {
    it("should return cohort details with calculated fields", async () => {
      const res = await request(app)
        .get(`/api/v1/cohorts/${testCohortId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(testCohortId);
      expect(res.body.data).toHaveProperty("calculatedStatus");
      expect(res.body.data).toHaveProperty("progressPercentage");
    });
  });



  describe("PATCH /api/v1/cohorts/:id/assign-tutor", () => {
    it("should allow admin to reassign tutor", async () => {
      // Create another tutor to reassign to
      const tutor2User = await TestFactory.createTutor({
          email: `tutor2-${Date.now()}@test.com`,
          firstName: "Tutor2",
          lastName: "Reassign",
          tutor: {
              staffId: `STAFF-TUTOR2-${Date.now()}`,
          }
      });

      const res = await request(app)
        .patch(`/api/v1/cohorts/${testCohortId}/assign-tutor`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ tutorId: tutor2User.tutor!.id });

      expect(res.status).toBe(200);
      expect(res.body.data.tutorId).toBe(tutor2User.tutor!.id);
      
      // Reassign back to original tutor to avoid foreign key constraint during cleanup
      await prisma.cohort.update({
        where: { id: testCohortId },
        data: { tutorId }
      });

      // Cleanup tutor2
      await prisma.user.delete({ where: { id: tutor2User.id } });
    });
  });

   // ============ TIMETABLE TESTS ============

  describe("POST /api/v1/cohorts/timetables", () => {
    it("should allow admin to create a timetable entry", async () => {
      const res = await request(app)
        .post("/api/v1/cohorts/timetables")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cohortId: testCohortId,
          dayOfWeek: "Monday",
          startTime: "09:00",
          endTime: "11:00",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.dayOfWeek).toBe("Monday");
      expect(res.body.data.startTime).toBe("09:00");
      testTimetableId = res.body.data.id;
    });

    it("should prevent tutor from creating timetable entry", async () => {
      const res = await request(app)
        .post("/api/v1/cohorts/timetables")
        .set("Authorization", `Bearer ${tutorToken}`)
        .send({
          cohortId: testCohortId,
          dayOfWeek: "Tuesday",
          startTime: "10:00",
          endTime: "12:00",
        });

      expect(res.status).toBe(403);
    });

    it("should prevent student from creating timetable entry", async () => {
      const res = await request(app)
        .post("/api/v1/cohorts/timetables")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          cohortId: testCohortId,
          dayOfWeek: "Wednesday",
          startTime: "14:00",
          endTime: "16:00",
        });

      expect(res.status).toBe(403);
    });

    it("should validate time format", async () => {
      const res = await request(app)
        .post("/api/v1/cohorts/timetables")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cohortId: testCohortId,
          dayOfWeek: "Monday",
          startTime: "9:00", // Invalid format (missing leading zero)
          endTime: "11:00",
        });

      expect(res.status).toBe(400);
    });

    it("should validate day of week", async () => {
      const res = await request(app)
        .post("/api/v1/cohorts/timetables")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cohortId: testCohortId,
          dayOfWeek: "Funday", 
          startTime: "09:00",
          endTime: "11:00",
        });

      expect(res.status).toBe(400);
    });

    it("should detect time conflicts", async () => {
      // Create first timetable entry
      // Create first timetable entry
      await TestFactory.createTimetable(testCohortId, {
          dayOfWeek: "Tuesday",
          startTime: "14:00",
          endTime: "16:00",
      });

      // Try to create overlapping entry
      const res = await request(app)
        .post("/api/v1/cohorts/timetables")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cohortId: testCohortId,
          dayOfWeek: "Tuesday",
          startTime: "15:00", // Overlaps with 14:00-16:00
          endTime: "17:00",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("conflict");
    });

    it("should validate that end time is after start time", async () => {
      const res = await request(app)
        .post("/api/v1/cohorts/timetables")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cohortId: testCohortId,
          dayOfWeek: "Wednesday",
          startTime: "15:00",
          endTime: "14:00", // Before start time
        });

      expect(res.status).toBe(400);
    });
  });

  describe("PATCH /api/v1/cohorts/timetables/:id", () => {
    it("should allow admin to update timetable entry", async () => {
      const res = await request(app)
        .patch(`/api/v1/cohorts/timetables/${testTimetableId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          startTime: "10:00",
          endTime: "12:00",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.startTime).toBe("10:00");
      expect(res.body.data.endTime).toBe("12:00");
    });

    it("should prevent tutor from updating timetable", async () => {
      const res = await request(app)
        .patch(`/api/v1/cohorts/timetables/${testTimetableId}`)
        .set("Authorization", `Bearer ${tutorToken}`)
        .send({
          startTime: "11:00",
        });

      expect(res.status).toBe(403);
    });

    it("should validate updated times don't create conflicts", async () => {
      // Create another entry on Monday
      // Create another entry on Monday
      const anotherEntry = await TestFactory.createTimetable(testCohortId, {
          dayOfWeek: "Monday",
          startTime: "14:00",
          endTime: "16:00",
      });

      // Try to update testTimetableId to overlap
      const res = await request(app)
        .patch(`/api/v1/cohorts/timetables/${testTimetableId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          startTime: "15:00",
          endTime: "17:00",
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("conflict");

      // Cleanup
      await prisma.timetable.delete({ where: { id: anotherEntry.id } });
    });
  });

  describe("GET /api/v1/cohorts/:cohortId/timetable/weekly", () => {
    beforeAll(async () => {
      // Create a full week's timetable
      const schedule = [
        { day: "Monday", start: "09:00", end: "11:00" },
        { day: "Tuesday", start: "09:00", end: "11:00" },
        { day: "Wednesday", start: "14:00", end: "16:00" },
        { day: "Thursday", start: "10:00", end: "12:00" },
        { day: "Friday", start: "09:00", end: "11:00" },
      ];

      for (const slot of schedule) {
        await TestFactory.createTimetable(testCohortId, {
            dayOfWeek: slot.day,
            startTime: slot.start,
            endTime: slot.end,
        });
      }
    });

    it("should allow student to view weekly timetable", async () => {
      const res = await request(app)
        .get(`/api/v1/cohorts/${testCohortId}/timetable/weekly`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("weekInfo");
      expect(res.body.data).toHaveProperty("schedule");
      expect(res.body.data.weekInfo).toHaveProperty("weekNumber");
      expect(res.body.data.weekInfo).toHaveProperty("startDate");
      expect(res.body.data.weekInfo).toHaveProperty("endDate");
      expect(Array.isArray(res.body.data.schedule)).toBe(true);
    });

    it("should allow tutor to view weekly timetable", async () => {
      const res = await request(app)
        .get(`/api/v1/cohorts/${testCohortId}/timetable/weekly`)
        .set("Authorization", `Bearer ${tutorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("schedule");
    });

    it("should include actual dates for each day", async () => {
      const res = await request(app)
        .get(`/api/v1/cohorts/${testCohortId}/timetable/weekly`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      const schedule = res.body.data.schedule;
      expect(schedule.length).toBeGreaterThan(0);
      expect(schedule[0]).toHaveProperty("actualDate");
      expect(schedule[0]).toHaveProperty("isPast");
      expect(schedule[0]).toHaveProperty("isToday");
    });

    it("should require authentication", async () => {
      const res = await request(app)
        .get(`/api/v1/cohorts/${testCohortId}/timetable/weekly`);

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/v1/cohorts/:cohortId/timetable/all", () => {
    it("should allow admin to view all timetables", async () => {
      const res = await request(app)
        .get(`/api/v1/cohorts/${testCohortId}/timetable/all`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("timetables");
      expect(Array.isArray(res.body.data.timetables)).toBe(true);
      expect(res.body.data).toHaveProperty("totalEntries");
    });

    it("should prevent tutor from accessing admin view", async () => {
      const res = await request(app)
        .get(`/api/v1/cohorts/${testCohortId}/timetable/all`)
        .set("Authorization", `Bearer ${tutorToken}`);

      expect(res.status).toBe(403);
    });

    it("should prevent student from accessing admin view", async () => {
      const res = await request(app)
        .get(`/api/v1/cohorts/${testCohortId}/timetable/all`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/v1/cohorts/timetables/:id", () => {
    it("should allow admin to delete timetable entry", async () => {
      // Create a timetable to delete
      // Create a timetable to delete
      const timetableToDelete = await TestFactory.createTimetable(testCohortId, {
          dayOfWeek: "Saturday",
          startTime: "10:00",
          endTime: "12:00",
      });

      const res = await request(app)
        .delete(`/api/v1/cohorts/timetables/${timetableToDelete.id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toContain("deleted successfully");

      // Verify deletion
      const deleted = await prisma.timetable.findUnique({
        where: { id: timetableToDelete.id }
      });
      expect(deleted).toBeNull();
    });

    it("should prevent tutor from deleting timetable", async () => {
      const res = await request(app)
        .delete(`/api/v1/cohorts/timetables/${testTimetableId}`)
        .set("Authorization", `Bearer ${tutorToken}`);

      expect(res.status).toBe(403);
    });

    it("should return 400 for non-existent timetable", async () => {
      const fakeId = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .delete(`/api/v1/cohorts/timetables/${fakeId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });
  });


});
