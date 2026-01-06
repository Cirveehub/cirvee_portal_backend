

// Mock Redis before importing app
// Mock Redis and BullMQ before importing app
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
import { IdGenerator } from "../../utils/idGenerator";
import { TestFactory } from "../../utils/factories";

describe("Super Admin Endpoints", () => {
  let superAdminToken: string;
  let superAdminId: string;
  let adminToken: string;
  let adminId: string;
  let testDepartmentId: string;

  beforeAll(async () => {
    // Create a test department 
    const testDept = await TestFactory.createDepartment({
      name: `Test-Dept-${Date.now()}`
    });
    testDepartmentId = testDept.id;

    // Create a Super Admin User
    const superAdmin = await TestFactory.createAdmin(testDepartmentId, {
      role: UserRole.SUPER_ADMIN,
      firstName: "Super",
      lastName: "Admin",
      admin: { permissions: ["SUPER_ADMIN"], staffId: `SA-${Date.now()}` }
    });
    superAdminId = superAdmin.id;
    superAdminToken = TokenUtil.generateAccessToken({
        id: superAdmin.id,
        email: superAdmin.email,
        role: superAdmin.role
    });

    // Create a Admin User 
    const adminUser = await TestFactory.createAdmin(testDepartmentId, {
      role: UserRole.ADMIN,
      firstName: "Regular",
      lastName: "Admin",
      admin: { permissions: ["READ_ONLY"], staffId: `ADM-${Date.now()}` }
    });
    adminId = adminUser.id;
    adminToken = TokenUtil.generateAccessToken({
        id: adminUser.id,
        email: adminUser.email,
        role: adminUser.role
    });
  });

  afterAll(async () => {
    await TestFactory.clearDatabase();
  });

  describe("POST /api/v1/admin/create-admin", () => {
    it("should allow SUPER_ADMIN to create an admin", async () => {
      const res = await request(app)
        .post("/api/v1/admin/create-admin")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          email: `newadmin-${Date.now()}@test.com`,
          password: "password123",
          firstName: "New",
          lastName: "Admin",
          department: testDepartmentId,
          permissions: ["READ_ONLY"],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe(UserRole.ADMIN);
    });

    it("should allow SUPER_ADMIN to create a SUPER_ADMIN", async () => {
        const res = await request(app)
          .post("/api/v1/admin/create-admin")
          .set("Authorization", `Bearer ${superAdminToken}`)
          .send({
            email: `newsuperadmin-${Date.now()}@test.com`,
            password: "password123",
            firstName: "New",
            lastName: "SuperAdmin",
            department: testDepartmentId,
            permissions: ["SUPER_ADMIN"],
          });
  
        expect(res.status).toBe(201);
        expect(res.body.data.user.role).toBe("SUPER_ADMIN");
      });
  });

  describe("POST /api/v1/admin/create-tutor", () => {
    it("should allow SUPER_ADMIN to create a tutor", async () => {
      const res = await request(app)
        .post("/api/v1/admin/create-tutor")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          email: `tutor-${Date.now()}@test.com`,
          password: "password123",
          firstName: "New",
          lastName: "Tutor",
          courseCode: "WEB101",
          bio: "Expert tutor",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.role).toBe(UserRole.TUTOR);
    });
  });

  describe("GET /api/v1/admin/admins", () => {
    it("should allow SUPER_ADMIN to get all admins", async () => {
      const res = await request(app)
        .get("/api/v1/admin/admins")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

   describe("GET /api/v1/admin/tutors", () => {
    it("should allow SUPER_ADMIN to get all tutors", async () => {
      const res = await request(app)
        .get("/api/v1/admin/tutors")
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
});
