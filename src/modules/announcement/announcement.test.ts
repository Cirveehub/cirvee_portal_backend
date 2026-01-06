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
import logger from "@utils/logger";

describe("Announcement Module - Complete Test Suite", () => {
  let superAdminToken: string;
  let adminToken: string;
  let tutorToken: string;
  let studentToken: string;
  let student2Token: string;
  let outsiderToken: string;

  let superAdminId: string;
  let adminId: string;
  let tutorId: string;
  let studentId: string;
  let student2Id: string;
  let outsiderId: string;

  let cohort1Id: string;
  let cohort2Id: string;

  let globalAnnouncementId: string;
  let cohortAnnouncementId: string;
  let multiCohortAnnouncementId: string;

  beforeAll(async () => {
    // Clean up before starting
    await TestFactory.clearDatabase();

    // 1. Create Department
    const dept = await TestFactory.createDepartment({
      name: `Test-Dept-Announcement-${Date.now()}`
    });

    // 2. Create Users
    const superAdminUser = await TestFactory.createAdmin(dept.id, {
      role: UserRole.SUPER_ADMIN,
      admin: { staffId: `STAFF-SUPERADMIN-${Date.now()}`, permissions: ["ALL"] }
    });
    
    const adminUser = await TestFactory.createAdmin(dept.id, {
      admin: { staffId: `STAFF-ADMIN-${Date.now()}`, permissions: ["CREATE_ANNOUNCEMENT"] }
    });

    const tutorUser = await TestFactory.createTutor({
       tutor: { departmentId: dept.id }
    });

    const studentUser = await TestFactory.createStudent();
    const student2User = await TestFactory.createStudent();
    const outsiderUser = await TestFactory.createStudent();

    superAdminId = superAdminUser.id;
    adminId = adminUser.admin!.id;
    tutorId = tutorUser.tutor!.id;
    studentId = studentUser.student!.id;
    student2Id = student2User.student!.id;
    outsiderId = outsiderUser.student!.id;

    // Tokens
    superAdminToken = TokenUtil.generateAccessToken({ id: superAdminUser.id, email: superAdminUser.email, role: UserRole.SUPER_ADMIN });
    adminToken = TokenUtil.generateAccessToken({ id: adminUser.id, email: adminUser.email, role: UserRole.ADMIN });
    tutorToken = TokenUtil.generateAccessToken({ id: tutorUser.id, email: tutorUser.email, role: UserRole.TUTOR });
    studentToken = TokenUtil.generateAccessToken({ id: studentUser.id, email: studentUser.email, role: UserRole.STUDENT });
    student2Token = TokenUtil.generateAccessToken({ id: student2User.id, email: student2User.email, role: UserRole.STUDENT });
    outsiderToken = TokenUtil.generateAccessToken({ id: outsiderUser.id, email: outsiderUser.email, role: UserRole.STUDENT });

    // 3. Create Course
    const course = await TestFactory.createCourse(adminId, {
      title: "Cohort dependency course",
      price: 50
    });

    // 4. Create Cohorts
    const cohort1 = await TestFactory.createCohort(course.id, tutorId, adminId, {
      name: `Test Cohort 1 - ${Date.now()}`
    });
    
    const cohort2 = await TestFactory.createCohort(course.id, tutorId, adminId, {
      name: `Test Cohort 2 - ${Date.now()}`
    });

    cohort1Id = cohort1.id;
    cohort2Id = cohort2.id;

    // 5. Enroll Students
    await TestFactory.createEnrollment(studentId, course.id, cohort1Id);
    await TestFactory.createEnrollment(student2Id, course.id, cohort2Id);
  });

  afterAll(async () => {
    await TestFactory.clearDatabase();
  });

  //  ANNOUNCEMENT CREATION 
  describe("Announcement Creation", () => {
    it("Should allow ADMIN to create global announcement", async () => {
      const res = await request(app)
        .post("/api/v1/announcements")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Global Announcement",
          content: "This is a global announcement for everyone",
          isGlobal: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isGlobal).toBe(true);
      globalAnnouncementId = res.body.data.id;
    });

    it("Should allow TUTOR to create cohort-specific announcement", async () => {
      const res = await request(app)
        .post("/api/v1/announcements")
        .set("Authorization", `Bearer ${tutorToken}`)
        .send({
          title: "Cohort 1 Announcement",
          content: "This announcement is for Cohort 1 only",
          isGlobal: false,
          cohortIds: [cohort1Id],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isGlobal).toBe(false);
      cohortAnnouncementId = res.body.data.id;
    });

    it("Should allow creating announcement for multiple cohorts", async () => {
      const res = await request(app)
        .post("/api/v1/announcements")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Multi-Cohort Announcement",
          content: "This announcement is for multiple cohorts",
          isGlobal: false,
          cohortIds: [cohort1Id, cohort2Id],
        });

      expect(res.status).toBe(201);
      multiCohortAnnouncementId = res.body.data.id;
    });

    it("Should NOT allow STUDENT to create announcement", async () => {
      const res = await request(app)
        .post("/api/v1/announcements")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          title: "Student Announcement",
          content: "This should fail",
          isGlobal: true,
        });

      expect(res.status).toBe(403);
    });

    it("Should reject non-global announcement without cohorts", async () => {
      const res = await request(app)
        .post("/api/v1/announcements")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Invalid Announcement",
          content: "Non-global without cohorts",
          isGlobal: false,
        });

      console.log(res.body);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("cohort");
  
    });

    it("Should reject invalid announcement data", async () => {
      const res = await request(app)
        .post("/api/v1/announcements")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "AB", // Too short
          content: "Short", // Too short
          isGlobal: true,
        });

      expect(res.status).toBe(400);
    });
  });

  //  ANNOUNCEMENT LISTING 
  describe("Announcement Listing", () => {
    it("Should list all announcements for admin", async () => {
      const res = await request(app)
        .get("/api/v1/announcements")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("Should show only accessible announcements to student", async () => {
      const res = await request(app)
        .get("/api/v1/announcements")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      // Student should see global + cohort1 announcements
      const hasGlobal = res.body.data.some((a: any) => a.id === globalAnnouncementId);
      const hasCohort1 = res.body.data.some((a: any) => a.id === cohortAnnouncementId);
      expect(hasGlobal).toBe(true);
      expect(hasCohort1).toBe(true);
    });

    it("Should NOT show inaccessible cohort announcements", async () => {
      const res = await request(app)
        .get("/api/v1/announcements")
        .set("Authorization", `Bearer ${outsiderToken}`);

      expect(res.status).toBe(200);
      // Outsider should only see global announcements
      const hasGlobal = res.body.data.some((a: any) => a.id === globalAnnouncementId);
      const hasCohort = res.body.data.some((a: any) => a.id === cohortAnnouncementId);
      expect(hasGlobal).toBe(true);
      expect(hasCohort).toBe(false);
    });

    it("Should support pagination", async () => {
      const res = await request(app)
        .get("/api/v1/announcements?page=1&limit=2")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const pagination = res.body.pagination || res.body.meta;
      expect(pagination).toBeDefined();
      expect(pagination.page).toBe(1);
      expect(pagination.limit).toBe(2);
    });
  });

  //  ANNOUNCEMENT ACCESS 
  describe("Announcement Access Control", () => {
    it("Should allow access to global announcement", async () => {
      const res = await request(app)
        .get(`/api/v1/announcements/${globalAnnouncementId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(globalAnnouncementId);
    });

    it("Should allow student to access their cohort announcement", async () => {
      const res = await request(app)
        .get(`/api/v1/announcements/${cohortAnnouncementId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
    });

    it("Should deny access to announcement outside student cohort", async () => {
      const res = await request(app)
        .get(`/api/v1/announcements/${cohortAnnouncementId}`)
        .set("Authorization", `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
    });

    it("Should allow admin to access any announcement", async () => {
      const res = await request(app)
        .get(`/api/v1/announcements/${cohortAnnouncementId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  //  ANNOUNCEMENT UPDATE 
  describe("Announcement Update", () => {
    it("Should allow creator to update announcement", async () => {
      const res = await request(app)
        .put(`/api/v1/announcements/${globalAnnouncementId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Updated Global Announcement",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.title).toBe("Updated Global Announcement");
    });

    it("Should allow super admin to update any announcement", async () => {
      const res = await request(app)
        .put(`/api/v1/announcements/${cohortAnnouncementId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          content: "Super admin updated this",
        });

      expect(res.status).toBe(200);
    });

    it("Should NOT allow non-creator to update announcement", async () => {
      const res = await request(app)
        .put(`/api/v1/announcements/${cohortAnnouncementId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Unauthorized update",
        });

      expect(res.status).toBe(403);
    });

    it("Should update cohort associations", async () => {
      const res = await request(app)
        .put(`/api/v1/announcements/${cohortAnnouncementId}`)
        .set("Authorization", `Bearer ${tutorToken}`)
        .send({
          cohortIds: [cohort2Id],
        });

      expect(res.status).toBe(200);
    });
  });

  //  LIKES 
  describe("Announcement Likes", () => {
    it("Should allow user to like announcement", async () => {
      const res = await request(app)
        .post(`/api/v1/announcements/${globalAnnouncementId}/like`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(true);
    });

    it("Should allow user to unlike announcement", async () => {
      const res = await request(app)
        .post(`/api/v1/announcements/${globalAnnouncementId}/like`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(false);
    });

    it("Should NOT allow liking inaccessible announcement", async () => {
      const res = await request(app)
        .post(`/api/v1/announcements/${cohortAnnouncementId}/like`)
        .set("Authorization", `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
    });
  });

  //  DELETION 
  describe("Announcement Deletion", () => {
    it("Should allow creator to delete announcement", async () => {
      const res = await request(app)
        .delete(`/api/v1/announcements/${multiCohortAnnouncementId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      const deletedData = res.body.data?.deletedData || res.body.data;
      expect(deletedData).toBeDefined();
    });

    it("Should allow super admin to delete any announcement", async () => {
      const res = await request(app)
        .delete(`/api/v1/announcements/${cohortAnnouncementId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
    });

    it("Should NOT allow non-creator to delete announcement", async () => {
      const res = await request(app)
        .delete(`/api/v1/announcements/${globalAnnouncementId}`)
        .set("Authorization", `Bearer ${tutorToken}`);

      expect(res.status).toBe(403);
    });
  });

  //  VALIDATION 
  describe("Input Validation", () => {
    it("Should require authentication", async () => {
      const res = await request(app).get("/api/v1/announcements");
      expect([401, 403]).toContain(res.status);
    });

    it("Should handle invalid UUIDs", async () => {
      const res = await request(app)
        .get("/api/v1/announcements/invalid-uuid")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
    });

    it("Should handle non-existent announcements", async () => {
      const fakeUuid = "00000000-0000-0000-0000-000000000000";
      const res = await request(app)
        .get(`/api/v1/announcements/${fakeUuid}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });

    it("Should reject invalid cohort IDs", async () => {
      const res = await request(app)
        .post("/api/v1/announcements")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          title: "Test Announcement",
          content: "Test content for validation",
          isGlobal: false,
          cohortIds: ["invalid-uuid"],
        });

      expect(res.status).toBe(400);
    });
  });
});