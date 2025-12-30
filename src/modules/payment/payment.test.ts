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

jest.mock("axios");

import request from "supertest";
import app from "../../app";
import prisma from "@config/database";
import { TokenUtil } from "../../utils/token";
import { UserRole } from "@prisma/client";
import axios from "axios";

const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("Payment Module - Complete Test Suite", () => {
  let adminToken: string;
  let studentToken: string;
  let student2Token: string;
  let superAdminToken: string;
  let tutorToken: string;
  let outsiderId: string;
  let outsiderToken: string;






  let adminId: string;
  let studentId: string;
  let student2Id: string;
  let superAdminId: string;


  let studentUserId: string;
  let student2UserId: string;

    let tutorId: string;
  let courseId: string;
  let cohortId: string;
  let cohort1Id: string;
  let cohort2Id: string;

  let paymentId: string;
  let installmentPaymentId: string;

  beforeAll(async () => {

      const dept = await prisma.department.create({
        data: {
          name: `Test-Dept-Announcement-${Date.now()}`,
          description: "Test department for announcement tests",
        },
      });
    
      const [superAdmin, admin, tutor, student, student2, outsider] = await Promise.all([
        prisma.user.create({
          data: {
            email: `superadmin-${Date.now()}@test.com`,
            password: "password",
            firstName: "Super",
            lastName: "Admin",
            role: UserRole.SUPER_ADMIN,
            isActive: true,
            isEmailVerified: true,
            admin: {
              create: {
                staffId: `STAFF-SUPERADMIN-${Date.now()}`,
                departmentId: dept.id,
                permissions: ["ALL"],
              }
            }
          },
          include: { admin: true }
        }),
        prisma.user.create({
          data: {
            email: `admin-${Date.now()}@test.com`,
            password: "password",
            firstName: "Admin",
            lastName: "User",
            role: UserRole.ADMIN,
            isActive: true,
            isEmailVerified: true,
            admin: {
              create: {
                staffId: `STAFF-ADMIN-${Date.now()}`,
                departmentId: dept.id,
                permissions: ["CREATE_ANNOUNCEMENT"],
              }
            }
          },
          include: { admin: true }
        }),
        prisma.user.create({
          data: {
            email: `tutor-${Date.now()}@test.com`,
            password: "password",
            firstName: "Tutor",
            lastName: "User",
            role: UserRole.TUTOR,
            isActive: true,
            isEmailVerified: true,
            tutor: {
              create: {
                staffId: `STAFF-TUTOR-${Date.now()}`,
                departmentId: dept.id,
                expertise: ["Testing"],
              }
            }
          },
          include: { tutor: true }
        }),
        // CREATE STUDENT RECORDS FOR STUDENT USERS
        prisma.user.create({
          data: {
            email: `student-${Date.now()}@test.com`,
            password: "password",
            firstName: "Student",
            lastName: "User",
            role: UserRole.STUDENT,
            isActive: true,
            isEmailVerified: true,
            student: {
              create: {
                studentId: `STU-${Date.now()}-1`,
              }
            }
          },
          include: { student: true }
        }),
        prisma.user.create({
          data: {
            email: `student2-${Date.now()}@test.com`,
            password: "password",
            firstName: "Student2",
            lastName: "User",
            role: UserRole.STUDENT,
            isActive: true,
            isEmailVerified: true,
            student: {
              create: {
                studentId: `STU-${Date.now()}-2`,
              }
            }
          },
          include: { student: true }
        }),
        prisma.user.create({
          data: {
            email: `outsider-${Date.now()}@test.com`,
            password: "password",
            firstName: "Out",
            lastName: "Side",
            role: UserRole.STUDENT,
            isActive: true,
            isEmailVerified: true,
            student: {
              create: {
                studentId: `STU-${Date.now()}-3`,
              }
            }
          },
          include: { student: true }
        }),
      ]);
    
      superAdminId = superAdmin.id;
      adminId = admin.admin!.id;
      tutorId = tutor.tutor!.id;
      studentId = student.student!.id;  
      student2Id = student2.student!.id; 
      outsiderId = outsider.student!.id;  
    
      superAdminToken = TokenUtil.generateAccessToken({ id: superAdmin.id, email: superAdmin.email, role: UserRole.SUPER_ADMIN });
      adminToken = TokenUtil.generateAccessToken({ id: admin.id, email: admin.email, role: UserRole.ADMIN });
      tutorToken = TokenUtil.generateAccessToken({ id: tutor.id, email: tutor.email, role: UserRole.TUTOR });
      studentToken = TokenUtil.generateAccessToken({ id: student.id, email: student.email, role: UserRole.STUDENT });
      student2Token = TokenUtil.generateAccessToken({ id: student2.id, email: student2.email, role: UserRole.STUDENT });
      outsiderToken = TokenUtil.generateAccessToken({ id: outsider.id, email: outsider.email, role: UserRole.STUDENT });
    
      const course = await prisma.course.create({
        data: {
          title: "Cohort dependency course",
          description: "Required for cohort",
          syllabus: ["Topic 1"],
          price: 50,
          duration: 2,
          createdById: adminId,
        }
      });
    
      const [cohort1, cohort2] = await Promise.all([
        prisma.cohort.create({
          data: {
            name: `Test Cohort 1 - ${Date.now()}`,
            startDate: new Date(),
            endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            courseId: course.id,
            tutorId: tutorId,
            createdById: adminId,
          },
        }),
        prisma.cohort.create({
          data: {
            name: `Test Cohort 2 - ${Date.now()}`,
            startDate: new Date(),
            endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
            courseId: course.id,
            tutorId: tutorId,
            createdById: adminId,
          },
        }),
      ]);
    
      cohort1Id = cohort1.id;
      cohort2Id = cohort2.id;
    
      // Enroll students in cogorts
      await Promise.all([
        // prisma.enrollment.create({
        //   data: { cohortId: cohort1Id, studentId, courseId: course.id },
        // }),
        prisma.enrollment.create({
          data: { cohortId: cohort2Id, studentId: student2Id, courseId: course.id },
        }),
      ]);

    // Mock Paystack responses
    // Mock Paystack responses
    (mockedAxios as any).mockImplementation((config: any) => {
      const method = config.method?.toUpperCase();
      const url = config.url || "";
      
      if (method === "POST") {
        return Promise.resolve({
          data: {
            status: true,
            message: "Authorization URL created",
            data: {
              authorization_url: "https://checkout.paystack.com/test123",
              access_code: "test_access_code",
              reference: `test_ref_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            },
          },
        });
      }
      
      if (method === "GET") {
        // Handle verification
        return Promise.resolve({
          data: {
            status: true,
            data: {
              status: "success",
              amount: 5000, // Default to 5000 kobo (50 naira)
              gateway_response: "Successful",
              channel: "card",
            },
          },
        });
      }

       return Promise.reject(new Error(`Unexpected axios call: ${method} ${config.url}`));
    });
  });


  afterAll(async () => {
    await prisma.paymentAuditLog.deleteMany();
    await prisma.paymentTransaction.deleteMany();
    await prisma.paymentRefund.deleteMany();
    await prisma.payment.deleteMany();
    await prisma.enrollment.deleteMany();
    await prisma.cohort.deleteMany();
    await prisma.course.deleteMany();
    await prisma.student.deleteMany();
    await prisma.tutor.deleteMany();
    await prisma.admin.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  //  PAYMENT INITIATION 
  describe("Payment Initiation", () => {
    it("Should allow student to initiate full payment", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          cohortId: cohort1Id,
          fullName: "Student One",
          phoneNumber: "+2348012345678",
          installmentPlan: "FULL_PAYMENT",
          amount: 50,
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("paymentId");
      expect(res.body.data).toHaveProperty("reference");
      expect(res.body.data).toHaveProperty("authorizationUrl");
      paymentId = res.body.data.paymentId;
    });

    it("Should allow student to initiate installment payment", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .set("Authorization", `Bearer ${student2Token}`)
        .send({
          cohortId: cohort1Id,
          fullName: "Student Two",
          phoneNumber: "+2348087654321",
          installmentPlan: "TWO_INSTALLMENTS",
          amount: 25,
        });

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("paymentId");
      installmentPaymentId = res.body.data.paymentId;
    });

    it("Should NOT allow duplicate payment for same cohort", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          cohortId: cohort1Id,
          fullName: "Student One",
          installmentPlan: "FULL_PAYMENT",
          amount: 50,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("pending payment");
    });

    it("Should NOT allow non-student to initiate payment", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          cohortId: cohort1Id,
          fullName: "Admin User",
          installmentPlan: "FULL_PAYMENT",
          amount: 50,
        });

      expect(res.status).toBe(403);
    });

    it("Should validate required fields", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          cohortId: cohort1Id,
          // Missing fullName and installmentPlan
        });

      expect(res.status).toBe(400);
    });

    it("Should validate installment plan values", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          cohort1Id,
          fullName: "Test",
          installmentPlan: "INVALID_PLAN",
        });

      expect(res.status).toBe(400);
    });
  });

  //  PAYMENT VERIFICATION 
  describe("Payment Verification", () => {
    it("Should verify payment with valid reference", async () => {
      // Get payment reference
      const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
      });

      const res = await request(app)
        .get(`/api/v1/payments/verify?reference=${payment!.reference}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("status");
      expect(res.body.data).toHaveProperty("reference");
    });

    it("Should return 404 for invalid reference", async () => {
      const res = await request(app)
        .get("/api/v1/payments/verify?reference=INVALID_REF")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(404);
    });

    it("Should require reference parameter", async () => {
      const res = await request(app)
        .get("/api/v1/payments/verify")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(400);
    });
  });

  //  MY PAYMENTS 
  describe("My Payments", () => {
    it("Should list student's payments", async () => {
      const res = await request(app)
        .get("/api/v1/payments/my-payments")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("Should support pagination", async () => {
      const res = await request(app)
        .get("/api/v1/payments/my-payments?page=1&limit=5")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.meta.page).toBe(1);
      expect(res.body.meta.limit).toBe(5);
    });

    it("Should NOT allow non-student to access", async () => {
      const res = await request(app)
        .get("/api/v1/payments/my-payments")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
    });
  });

  //  PAYMENT DETAILS 
  describe("Payment Details", () => {
    it("Should allow student to view their payment details", async () => {
      const res = await request(app)
        .get(`/api/v1/payments/${paymentId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(paymentId);
      expect(res.body.data).toHaveProperty("totalAmount");
      expect(res.body.data).toHaveProperty("status");
    });

    it("Should NOT allow student to view other's payment", async () => {
      const res = await request(app)
        .get(`/api/v1/payments/${paymentId}`)
        .set("Authorization", `Bearer ${student2Token}`);

      expect(res.status).toBe(403);
    });

    it("Should return 404 for invalid payment ID", async () => {
      const res = await request(app)
        .get("/api/v1/payments/00000000-0000-0000-0000-000000000000")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(404);
    });
  });

  //  SECOND INSTALLMENT 
  describe("Second Installment Payment", () => {
    it("Should NOT allow second installment before first is paid", async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${installmentPaymentId}/pay-second-installment`)
        .set("Authorization", `Bearer ${student2Token}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("First installment");
    });

    it("Should NOT allow for full payment plans", async () => {
      const res = await request(app)
        .post(`/api/v1/payments/${paymentId}/pay-second-installment`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("not an installment");
    });
  });

  //  ADMIN ENDPOINTS 
  describe("Admin - List All Payments", () => {
    it("Should allow admin to list all payments", async () => {
      const res = await request(app)
        .get("/api/v1/payments/admin/all")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });

    it("Should support status filter", async () => {
      const res = await request(app)
        .get("/api/v1/payments/admin/all?status=PENDING")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("Should support cohort filter", async () => {
      const res = await request(app)
        .get(`/api/v1/payments/admin/all?cohortId=${cohort1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.every((p: any) => p.cohort.id === cohort1Id)).toBe(true);
    });

    it("Should support installment plan filter", async () => {
      const res = await request(app)
        .get("/api/v1/payments/admin/all?installmentPlan=TWO_INSTALLMENTS")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it("Should NOT allow student to access", async () => {
      const res = await request(app)
        .get("/api/v1/payments/admin/all")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe("Admin - Payment Details", () => {
    it("Should allow admin to view any payment details", async () => {
      const res = await request(app)
        .get(`/api/v1/payments/admin/${paymentId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(paymentId);
      expect(res.body.data).toHaveProperty("auditLogs");
      expect(res.body.data).toHaveProperty("transactions");
    });
  });

  describe("Admin - Update Payment Status", () => {
    it("Should allow admin to update payment status", async () => {
      const res = await request(app)
        .patch(`/api/v1/payments/admin/${paymentId}/update-status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "CANCELLED",
          notes: "Test cancellation",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("CANCELLED");
    });

    it("Should validate status values", async () => {
      const res = await request(app)
        .patch(`/api/v1/payments/admin/${paymentId}/update-status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "INVALID_STATUS",
        });

      expect(res.status).toBe(400);
    });

    it("Should NOT allow student to update status", async () => {
      const res = await request(app)
        .patch(`/api/v1/payments/admin/${paymentId}/update-status`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          status: "COMPLETED",
        });

      expect(res.status).toBe(403);
    });
  });

  describe("Admin - Payment Statistics", () => {
    it("Should get payment statistics", async () => {
      const res = await request(app)
        .get("/api/v1/payments/admin/statistics")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("totalPayments");
      expect(res.body.data).toHaveProperty("completedPayments");
      expect(res.body.data).toHaveProperty("pendingPayments");
      expect(res.body.data).toHaveProperty("totalRevenue");
    });

    it("Should support date range filter", async () => {
      const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
      const endDate = new Date().toISOString().split("T")[0];

      const res = await request(app)
        .get(`/api/v1/payments/admin/statistics?startDate=${startDate}&endDate=${endDate}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  //  AUTHORIZATION 
  describe("Authorization", () => {
    it("Should require authentication for all endpoints", async () => {
      const endpoints = [
        { method: "post", path: "/api/v1/payments/initiate" },
        { method: "get", path: "/api/v1/payments/my-payments" },
        { method: "get", path: "/api/v1/payments/admin/all" },
      ];

      for (const endpoint of endpoints) {
        const res = await (request(app) as any)[endpoint.method](endpoint.path);
        expect([401, 403]).toContain(res.status);
      }
    });

    it("Should handle invalid UUIDs", async () => {
      const res = await request(app)
        .get("/api/v1/payments/invalid-uuid")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(400);
    });
  });

  //  VALIDATION 
  describe("Input Validation", () => {
    it("Should validate phone number format", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          cohortId: cohort1Id,
          fullName: "Test User",
          phoneNumber: "invalid-phone",
          installmentPlan: "FULL_PAYMENT",
          amount: 50,
        });

      expect(res.status).toBe(400);
    });

   it("Should validate cohort ID format", async () => {
      const res = await request(app)
        .post("/api/v1/payments/initiate")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          cohortId: "invalid-uuid",
          fullName: "Test User",
          installmentPlan: "FULL_PAYMENT",
          amount: 50,
        });

      expect(res.status).toBe(400);
    });
  });
});
