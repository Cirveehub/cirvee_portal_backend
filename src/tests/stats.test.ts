import request from "supertest";
import app from "../app";
import prisma from "../config/database"; 
import { UserRole, PaymentState } from "@prisma/client";
import { TokenUtil } from "../utils/token";
import { TestFactory } from "../utils/factories";

describe("Stats Endpoints", () => {
    let studentToken: string;
    let tutorToken: string;
    let adminToken: string;
    let studentId: string;
    let tutorId: string;
    let cohortId: string;
    let courseId: string;
    let adminId: string;

    beforeAll(async () => {
        // Cleanup using factory
        await TestFactory.clearDatabase();

        // Create Admin
        const adminUser = await TestFactory.createAdmin(undefined, {
            email: "admin_stats@test.com",
            admin: { staffId: "STF_ADM_STATS", permissions: ["ALL"] }
        });
        adminId = adminUser.admin!.id;
        adminToken = TokenUtil.generateAccessToken({ id: adminUser.id, email: adminUser.email, role: adminUser.role });

        // Create Course
        const course = await TestFactory.createCourse(adminId, {
            price: 1000,
            duration: 4
        });
        courseId = course.id;

        // Create Tutor
        const tutorUser = await TestFactory.createTutor({
            email: "tutor_stats@test.com",
            tutor: { staffId: "STF_TUT_STATS" }
        });
        tutorId = tutorUser.tutor!.id;
        tutorToken = TokenUtil.generateAccessToken({ id: tutorUser.id, email: tutorUser.email, role: tutorUser.role });

        // Create Cohort (Ongoing)
        const cohort = await TestFactory.createCohort(courseId, tutorId, adminId, {
            name: "Stats Cohort 1",
            status: "ONGOING"
        });
        cohortId = cohort.id;

        // Create Student
        const studentUser = await TestFactory.createStudent({
            email: "student_stats@test.com",
            student: { studentId: "STD_STATS_001" }
        });
        studentId = studentUser.student!.id;
        studentToken = TokenUtil.generateAccessToken({ id: studentUser.id, email: studentUser.email, role: studentUser.role });

        // Enroll Student
        await TestFactory.createEnrollment(studentId, courseId, cohortId);

        // Create Assignment
        await TestFactory.createAssignment(cohortId, tutorId, {
            dueDate: new Date(Date.now() + 86400000), // Tomorrow
        });

        // Create Payment
        await TestFactory.createPayment(studentId, studentUser.id, courseId, cohortId);
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    it("GET /stats/student - should return student stats", async () => {
        const res = await request(app)
            .get("/api/v1/stats/student")
            .set("Authorization", `Bearer ${studentToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("activeCourses", 1);
        expect(res.body.data).toHaveProperty("pendingAssignments", 1);
    });

    // Tutor Stats
    it("GET /stats/tutor - should return tutor stats", async () => {
        const res = await request(app)
            .get("/api/v1/stats/tutor")
            .set("Authorization", `Bearer ${tutorToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty("totalStudents", 1);
        // Sessions might be 0 if no timetable for today
    });

    // Admin Stats
    it("GET /stats/admin/dashboard - should return admin dashboard stats", async () => {
        const res = await request(app)
            .get("/api/v1/stats/admin/dashboard")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.data.totalStudents).toBeGreaterThanOrEqual(1);
    });

    it("GET /stats/admin/financial - should return financial stats", async () => {
        const res = await request(app)
            .get("/api/v1/stats/admin/financial")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.totalRevenue).toBe(5000); // 500000 kobo / 100
    });

    it("GET /stats/admin/academic - should return academic stats", async () => {
        const res = await request(app)
            .get("/api/v1/stats/admin/academic")
            .set("Authorization", `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        expect(res.body.data.totalCourses).toBeGreaterThanOrEqual(1);
        expect(res.body.data.topCourses).toBeInstanceOf(Array);
    });
});
