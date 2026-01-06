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

describe("Community Module - Complete Test Suite", () => {
  let adminToken: string;
  let superAdminToken: string;
  let tutorToken: string;
  let studentToken: string;
  let student2Token: string;
  let outsiderToken: string;

  let adminId: string;
  let superAdminId: string;
  let tutorId: string;
  let studentId: string;
  let student2Id: string;
  let outsiderId: string;

  let publicCommunityId: string;
  let privateCommunityId: string;
  let tutorCommunityId: string;

  let postId: string;
  let post2Id: string;
  let commentId: string;
  let replyId: string;

  beforeAll(async () => {
    await TestFactory.clearDatabase();
    
    // Create test users
    // 1. Super Admin
    const superAdminUser = await TestFactory.createAdmin(undefined, {
      role: UserRole.SUPER_ADMIN,
      firstName: "Super",
      lastName: "Admin",
      admin: { permissions: ["*"] }
    });

    // 2. Admin
    const adminUser = await TestFactory.createAdmin(undefined, {
      role: UserRole.ADMIN,
      firstName: "Admin",
      lastName: "User",
      admin: { permissions: ["*"] }
    });

    // 3. Tutor
    const tutorUser = await TestFactory.createTutor({
      firstName: "Tutor",
      lastName: "User"
    });

    // 4. Students
    const studentUser = await TestFactory.createStudent({
      firstName: "Student",
      lastName: "User"
    });

    const student2User = await TestFactory.createStudent({
      firstName: "Student2", 
      lastName: "User"
    });

    const outsiderUser = await TestFactory.createStudent({
      firstName: "Out", 
      lastName: "Side"
    });

    superAdminId = superAdminUser.id;
    adminId = adminUser.admin!.id; // Note: TestFactory.createAdmin returns User, but we need admin ID for community linking if needed, but here it looks like mostly token based or just user IDs?
    // Wait, the original test sets adminId = admin.id (User ID) NOT admin.admin.id?
    // Let's double check line 116: adminId = admin.id; -- YES, User ID.
    // Line 115: superAdminId = superAdmin.id; -- YES, User ID.
    // Line 117: tutorId = tutor.id; -- YES, User ID.
    
    // Actually, looking at usages:
    // create public community -> set Authorization adminToken
    // create private community -> set Authorization adminToken
    
    // So for Community module, it seems to rely on User IDs primarily or implied via token.
    // Let's re-read the original assignment carefully.
    
    superAdminId = superAdminUser.id;
    adminId = adminUser.id;
    tutorId = tutorUser.id;
    studentId = studentUser.id;
    student2Id = student2User.id;
    outsiderId = outsiderUser.id;

    superAdminToken = TokenUtil.generateAccessToken({ id: superAdminId, email: superAdminUser.email, role: UserRole.SUPER_ADMIN });
    adminToken = TokenUtil.generateAccessToken({ id: adminId, email: adminUser.email, role: UserRole.ADMIN });
    tutorToken = TokenUtil.generateAccessToken({ id: tutorId, email: tutorUser.email, role: UserRole.TUTOR });
    studentToken = TokenUtil.generateAccessToken({ id: studentId, email: studentUser.email, role: UserRole.STUDENT });
    student2Token = TokenUtil.generateAccessToken({ id: student2Id, email: student2User.email, role: UserRole.STUDENT });
    outsiderToken = TokenUtil.generateAccessToken({ id: outsiderId, email: outsiderUser.email, role: UserRole.STUDENT });
  });

  afterAll(async () => {
    await TestFactory.clearDatabase();
  });

  //COMMUNITY CREATION
  describe("Community Creation", () => {
    it("Should allow ADMIN to create public community", async () => {
      const res = await request(app)
        .post("/api/v1/communities")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Public Community",
          description: "A public community for everyone",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe("Public Community");
      expect(res.body.data.isPrivate).toBe(false);
      publicCommunityId = res.body.data.id;
    });

    it("Should allow ADMIN to create private community", async () => {
      const res = await request(app)
        .post("/api/v1/communities")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Private Community",
          description: "A private community with restricted access",
          isPrivate: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.isPrivate).toBe(true);
      privateCommunityId = res.body.data.id;
    });

    it("Should allow TUTOR to create community", async () => {
      const res = await request(app)
        .post("/api/v1/communities")
        .set("Authorization", `Bearer ${tutorToken}`)
        .send({
          name: "Tutor Community",
          description: "Community created by tutor",
        });

      expect(res.status).toBe(201);
      tutorCommunityId = res.body.data.id;
    });

    it("Should NOT allow STUDENT to create community", async () => {
      const res = await request(app)
        .post("/api/v1/communities")
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          name: "Student Community",
          description: "Should fail",
        });

      expect(res.status).toBe(403);
    });

    it("Should reject invalid community data", async () => {
      const res = await request(app)
        .post("/api/v1/communities")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "AB", // Too short
          description: "Short", // Too short
        });

      expect(res.status).toBe(400);
    });
  });

  //COMMUNITY LISTING
  describe("Community Listing", () => {
    it("Should list all accessible communities", async () => {
      const res = await request(app)
        .get("/api/v1/communities")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.some((c: any) => c.id === publicCommunityId)).toBe(true);
    });

    it("Should support search functionality", async () => {
      const res = await request(app)
        .get("/api/v1/communities?search=Public")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.some((c: any) => c.name.includes("Public"))).toBe(true);
    });

    it("Should support pagination", async () => {
      const res = await request(app)
        .get("/api/v1/communities?page=1&limit=2")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      const pagination = res.body.pagination || res.body.meta;
      expect(pagination).toBeDefined();
      expect(pagination.page).toBe(1);
      expect(pagination.limit).toBe(2);
    });
  });

  // COMMUNITY ACCESS
  describe("Community Access Control", () => {
    it("Should allow access to public community details", async () => {
      const res = await request(app)
        .get(`/api/v1/communities/${publicCommunityId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.community.id).toBe(publicCommunityId);
    });

    it("Should deny access to private community for non-members", async () => {
      const res = await request(app)
        .get(`/api/v1/communities/${privateCommunityId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it("Should allow creator to access private community", async () => {
      const res = await request(app)
        .get(`/api/v1/communities/${privateCommunityId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });
  });

  //COMMUNITY UPDATE
  describe("Community Update", () => {
    it("Should allow creator to update community", async () => {
      const res = await request(app)
        .put(`/api/v1/communities/${publicCommunityId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Updated Public Community",
          description: "Updated description for public community",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Updated Public Community");
    });

    it("Should allow admin to update any community", async () => {
      const res = await request(app)
        .put(`/api/v1/communities/${tutorCommunityId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          description: "Admin updated this description",
        });

      expect(res.status).toBe(200);
    });

    it("Should NOT allow non-creator to update community", async () => {
      const res = await request(app)
        .put(`/api/v1/communities/${publicCommunityId}`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          name: "Unauthorized Update",
        });

      expect(res.status).toBe(403);
    });
  });

  // MEMBERSHIP
  describe("Community Membership", () => {
    it("Should allow joining public community", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/join`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(201);
    });

    it("Should prevent duplicate joins", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/join`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("already");
    });

    it("Should NOT allow joining private community", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${privateCommunityId}/join`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });

    it("Should list community members", async () => {
      const res = await request(app)
        .get(`/api/v1/communities/${publicCommunityId}/members`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("Should allow leaving community", async () => {
      // First join with student2
      await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/join`)
        .set("Authorization", `Bearer ${student2Token}`);

      // Then leave
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/leave`)
        .set("Authorization", `Bearer ${student2Token}`);

      expect(res.status).toBe(200);
    });

    it("Should NOT allow creator to leave", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/leave`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("creator");
    });
  });

  //POSTS
  describe("Post Management", () => {
    it("Should allow member to create post", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/posts`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "Hello community! This is my first post.",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.content).toBe("Hello community! This is my first post.");
      postId = res.body.data.id;
    });

    it("Should NOT allow non-member to create post", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/posts`)
        .set("Authorization", `Bearer ${outsiderToken}`)
        .send({
          content: "Unauthorized post",
        });

      expect(res.status).toBe(403);
    });

    it("Should get single post detail", async () => {
      const res = await request(app)
        .get(`/api/v1/communities/posts/${postId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(postId);
    });

    it("Should allow author to update post", async () => {
      const res = await request(app)
        .put(`/api/v1/communities/posts/${postId}`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "Updated post content",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe("Updated post content");
    });

    it("Should NOT allow non-author to update post", async () => {
      const res = await request(app)
        .put(`/api/v1/communities/posts/${postId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          content: "Unauthorized update",
        });

      expect(res.status).toBe(403);
    });

    it("Should create another post for testing", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/posts`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          content: "Admin's post for testing",
        });

      expect(res.status).toBe(201);
      post2Id = res.body.data.id;
    });
  });

  //LIKES
  describe("Post Likes", () => {
    it("Should allow member to like post", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/posts/${postId}/like`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(true);
    });

    it("Should allow member to unlike post", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/posts/${postId}/like`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.liked).toBe(false);
    });

    it("Should NOT allow non-member to like post", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/posts/${postId}/like`)
        .set("Authorization", `Bearer ${outsiderToken}`);

      expect(res.status).toBe(403);
    });
  });

  //COMMENTS
  describe("Comment Management", () => {
    it("Should allow member to add comment", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/posts/${postId}/comments`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "This is a top-level comment",
        });

      expect(res.status).toBe(201);
      expect(res.body.data.content).toBe("This is a top-level comment");
      commentId = res.body.data.id;
    });

    it("Should allow adding reply to comment", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/posts/${postId}/comments`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          content: "This is a reply to the comment",
          parentId: commentId,
        });

      expect(res.status).toBe(201);
      replyId = res.body.data.id;
    });

    it("Should NOT allow replies deeper than 2 levels", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/posts/${postId}/comments`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "This should fail",
          parentId: replyId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("deeper");
    });

    it("Should get post comments (paginated)", async () => {
      const res = await request(app)
        .get(`/api/v1/communities/posts/${postId}/comments`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("Should get comment replies", async () => {
      const res = await request(app)
        .get(`/api/v1/communities/comments/${commentId}/replies`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("Should allow author to update comment", async () => {
      const res = await request(app)
        .put(`/api/v1/communities/comments/${commentId}`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "Updated comment content",
        });

      expect(res.status).toBe(200);
      expect(res.body.data.content).toBe("Updated comment content");
    });

    it("Should NOT allow non-author to update comment", async () => {
      const res = await request(app)
        .put(`/api/v1/communities/comments/${commentId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          content: "Unauthorized update",
        });

      expect(res.status).toBe(403);
    });

    it("Should NOT allow non-member to comment", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/posts/${postId}/comments`)
        .set("Authorization", `Bearer ${outsiderToken}`)
        .send({
          content: "Unauthorized comment",
        });

      expect(res.status).toBe(403);
    });
  });

  //DELETIONS
  describe("Deletion Operations", () => {
    it("Should allow author to delete comment (and replies)", async () => {
      const res = await request(app)
        .delete(`/api/v1/communities/comments/${commentId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.deletedReplies).toBeGreaterThanOrEqual(0);
    });

    it("Should allow author to delete post", async () => {
      const res = await request(app)
        .delete(`/api/v1/communities/posts/${postId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(200);
    });

    it("Should allow admin to delete any post", async () => {
      const res = await request(app)
        .delete(`/api/v1/communities/posts/${post2Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
    });

    it("Should allow creator to delete community", async () => {
      const res = await request(app)
        .delete(`/api/v1/communities/${tutorCommunityId}`)
        .set("Authorization", `Bearer ${tutorToken}`);

      expect(res.status).toBe(200);
      // Check for deletedData in data object or at root level
      const deletedData = res.body.data?.deletedData || res.body.data;
      expect(deletedData).toBeDefined();
    });

    it("Should allow super admin to delete any community", async () => {
      // Create test community first
      const createRes = await request(app)
        .post("/api/v1/communities")
        .set("Authorization", `Bearer ${tutorToken}`)
        .send({
          name: "To Be Deleted",
          description: "This will be deleted by super admin",
        });

      const communityId = createRes.body.data.id;

      // Super admin deletes it
      const res = await request(app)
        .delete(`/api/v1/communities/${communityId}`)
        .set("Authorization", `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
    });

    it("Should NOT allow non-creator to delete community", async () => {
      const res = await request(app)
        .delete(`/api/v1/communities/${publicCommunityId}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(403);
    });
  });

  //AUTHORIZATION TESTS
  describe("Authorization Edge Cases", () => {
    it("Should require authentication for all endpoints", async () => {
      const endpoints = [
        { method: "get", path: "/api/v1/communities" },
        { method: "post", path: "/api/v1/communities" },
        { method: "get", path: `/api/v1/communities/${publicCommunityId}` },
      ];

      for (const endpoint of endpoints) {
        const res = await (request(app) as any)[endpoint.method](endpoint.path);
        expect([401, 403]).toContain(res.status);
      }
    });

    it("Should handle invalid UUIDs gracefully", async () => {
      const res = await request(app)
        .get("/api/v1/communities/invalid-uuid")
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(400);
    });

    it("Should handle non-existent resources", async () => {
      const fakeUuid = "00000000-0000-0000-0000-000000000000";
      
      const res = await request(app)
        .get(`/api/v1/communities/${fakeUuid}`)
        .set("Authorization", `Bearer ${studentToken}`);

      expect(res.status).toBe(404);
    });
  });

  //VALIDATION TESTS
  describe("Input Validation", () => {
    it("Should reject empty post content", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/posts`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "",
        });

      expect(res.status).toBe(400);
    });

    it("Should reject post content exceeding limit", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/posts`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "a".repeat(5001),
        });

      expect(res.status).toBe(400);
    });

    it("Should reject too many attachments", async () => {
      const res = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/posts`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "Valid content",
          attachments: Array(11).fill("http://example.com/image.jpg"),
        });

      expect(res.status).toBe(400);
    });

    it("Should reject comment exceeding length limit", async () => {
      // Create a post first
      const postRes = await request(app)
        .post(`/api/v1/communities/${publicCommunityId}/posts`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "Test post for comment validation",
        });

      const testPostId = postRes.body.data.id;

      const res = await request(app)
        .post(`/api/v1/communities/posts/${testPostId}/comments`)
        .set("Authorization", `Bearer ${studentToken}`)
        .send({
          content: "a".repeat(1001),
        });

      expect(res.status).toBe(400);
    });
  });
});