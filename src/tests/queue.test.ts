import { QueueService } from "../services/queue.service";
import worker from "../workers/email.worker";
import { EmailUtil } from "../utils/email";
import { describe, it, expect, jest, beforeAll, afterAll } from '@jest/globals';

jest.mock("../utils/email"); // Mock EmailUtil

describe("Queue System", () => {
    beforeAll(async () => {
        const queue = QueueService.queues[0];
        await queue.obliterate({ force: true });
        await worker.waitUntilReady();
    });

    afterAll(async () => {
        await worker.close();
        const queue = QueueService.queues[0];
        await queue.close();
    });

    it("should process email jobs", async () => {
        const payload = {
            email: "test@queue.com",
            name: "Queue Test",
            otp: "123456"
        };
        
        const mockFn = EmailUtil.sendVerificationEmail as jest.Mock;
        mockFn.mockImplementation(async () => {
            console.log("MOCK processVerificationEmail called!");
        });
        mockFn.mockClear();

        const job = await QueueService.addEmailJob({
            type: "VERIFICATION",
            payload
        });
        console.log(`Test 1 Job added: ${job.id}`);

        await new Promise(resolve => setTimeout(resolve, 8000));
        expect(mockFn).toHaveBeenCalledWith(payload.email, payload.name, payload.otp);
    }, 30000);

    it("should process assignment creation emails", async () => {
        const payload = {
            email: "student@test.com",
            studentName: "Student",
            assignmentTitle: "Test Assignment",
            courseTitle: "Test Course",
            dueDate: "2024-12-31T23:59:59.000Z"
        };
        
        const mockFn = EmailUtil.sendAssignmentCreatedEmail as jest.Mock;
        mockFn.mockImplementation(async () => {
            console.log("MOCK sendAssignmentCreatedEmail called!");
        });
        mockFn.mockClear();

        const job = await QueueService.addEmailJob({
            type: "ASSIGNMENT_CREATED",
            payload: {
                ...payload,
                dueDate: new Date(payload.dueDate)
            }
        });
        console.log(`Test 2 Job added: ${job.id}`);
        
        const queue = QueueService.queues[0];
        console.log(`Test 2 Queue counts:`, await queue.getJobCounts());

        await new Promise(resolve => setTimeout(resolve, 8000));
        
        console.log(`Test 2 Queue counts after:`, await queue.getJobCounts());

        expect(mockFn).toHaveBeenCalledWith(
            payload.email, 
            payload.studentName, 
            payload.assignmentTitle, 
            payload.courseTitle, 
            expect.anything()
        );
    }, 30000);

    it("should process announcement emails", async () => {
        const payload = {
            email: "student@test.com",
            name: "Student",
            title: "Test Announcement",
            content: "Content",
            senderName: "Admin"
        };
        
        const mockFn = EmailUtil.sendAnnouncementEmail as jest.Mock;
        mockFn.mockImplementation(async () => {
            console.log("MOCK sendAnnouncementEmail called!");
        });
        mockFn.mockClear();

        const job = await QueueService.addEmailJob({
            type: "ANNOUNCEMENT_NEW",
            payload
        });
        console.log(`Test 3 Job added: ${job.id}`);

        await new Promise(resolve => setTimeout(resolve, 8000));

        expect(mockFn).toHaveBeenCalledWith(
            payload.email, 
            payload.name, 
            payload.title, 
            payload.content, 
            payload.senderName
        );
    }, 30000);
});
