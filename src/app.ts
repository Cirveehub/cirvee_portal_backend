import express, { Application, Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import morgan from "morgan";
import session from "express-session";
import "express-async-errors";
import swaggerJSDoc from "swagger-jsdoc";
import swaggerUi from "swagger-ui-express";
import dotenv from "dotenv";
import { errorHandler, notFoundHandler } from "./middleware/error.middleware";
import { ResponseUtil } from "./utils/response";
import logger from "./utils/logger";
import prisma from "@config/database";
import redis from "./config/redis";
import passport from "./config/passport";

//  routes -> Move to routes/index.ts  

import authRoutes from "./modules/auth/auth.routes";
import adminRoutes from "./modules/admin/admin.routes";
import courseRoutes from "./modules/course/course.routes";
import cohortRoutes from "./modules/cohort/cohort.routes";
import academicRoutes from "./modules/academic/academic.routes";
import attendanceRoutes from "./modules/attendance/attendance.routes";
import communityRoutes from "./modules/community/community.routes";
import announcementRoutes from "./modules/announcement/announcement.routes";
import paymentRoutes from "./modules/payment/payment.routes";
import statsRoutes from "./modules/stats/stats.routes";

dotenv.config();

const app: Application = express();

const PORT = process.env.PORT || 5000;

app.use(helmet());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
    credentials: true,
  })
);
app.use(compression());

if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Session for Passport
app.use(
  session({
    secret: process.env.JWT_SECRET || "wertyuiopsouytrt67s8iksjgft",
    resave: false,
    saveUninitialized: false,
  })
);

// Passport
app.use(passport.initialize());
app.use(passport.session());

//Swagger Config
const swaggerOptions: swaggerJSDoc.Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Cirvee Portal API Documentation",
      version: "1.0.0",
      description: " API documentation for Cirvee Portal",
    },
    servers: [
      {
        url: `http://localhost:${PORT}`,
        description: "Local development server",
      },
      {
        url: process.env.PRODUCTION_URL || "https://api.cirvee.com",
        description: "Production server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
  },
  apis: ["./src/routes/*.ts", "./src/modules/**/*.routes.ts", "./src/app.ts"],
};

const swaggerSpec = swaggerJSDoc(swaggerOptions);

app.use(
  "/api/v1/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Cirvee Portal API Docs",
  })
);

/*Health Check*/
/**
 * @swagger
 * /api/v1/health:
 *   get:
 *     summary: Health check endpoint
 *     description: Check if the server is running
 *     tags: [System]
 *     responses:
 *       200:
 *         description: Server is healthy
 */
app.get("/api/v1/health", (req: Request, res: Response) => {
  ResponseUtil.success(res, "Server is healthy", {
    status: "OK",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
  });
});

/*System Test Endpoint*/
/**
 * @swagger
 * /api/v1/test-system:
 *   get:
 *     summary: Test all system connections
 *     description: Test PostgreSQL, Redis, Logger, and all imporant utilities
 *     tags: [System]
 *     responses:
 *       200:
 *         description: System test results
 */
app.get("/api/v1/test-system", async (req: Request, res: Response) => {
  const results: any = {
    server: { status: "success", message: "Server running" },
    postgres: { status: "error", message: "Not tested" },
    redis: { status: "error", message: "Not tested" },
    logger: { status: "error", message: "Not tested" },
    prisma: { status: "error", message: "Not tested" },
  };

  try {
    // Test PostgreSQL
    try {
      await prisma.$queryRaw`SELECT 1 as result`;
      results.postgres = {
        status: "success",
        message: "Connected successfully",
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      results.postgres = { status: "error", message: error.message };
    }

    // Test Redis
    try {
      await redis.set("test_system", "working", "EX", 10);
      const value = await redis.get("test_system");

      if (value === "working") {
        results.redis = {
          status: "success",
          message: "Connected and working",
          test: "Read/Write successful",
        };
        await redis.del("test_system");
      } else {
        results.redis = {
          status: "",
          message: "Connected but read/write test failed",
        };
      }
    } catch (error: any) {
      results.redis = { status: "error", message: error.message };
    }

    // Test Logger
    try {
      logger.info("Logger test - INFO level");
      logger.error("Logger test - ERROR level");
      results.logger = {
        status: "success",
        message: "Winston logger working",
        logFile: "logs/combined.log",
      };
    } catch (error: any) {
      results.logger = { status: "error", message: error.message };
    }

    // Test Prisma Client
    try {
      const userCount = await prisma.user.count();
      results.prisma = {
        status: "success",
        message: "Prisma Client working",
        info: `Total users in database: ${userCount}`,
      };
    } catch (error: any) {
      results.prisma = { status: "error", message: error.message };
    }

    const allPassed = Object.values(results).every(
      (r: any) => r.status === "success"
    );

    ResponseUtil.success(
      res,
      allPassed ? "All systems operational" : "Some systems have issues",
      results
    );
  } catch (error: any) {
    logger.error("System test failed:", error);
    ResponseUtil.internalError(res, "System test failed");
  }
});

//API Routes
// ... existing imports


app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/stats", statsRoutes); // Register stats routes
app.use("/api/v1/courses", courseRoutes);

app.use("/api/v1/cohorts", cohortRoutes);
app.use("/api/v1/academic", academicRoutes);
app.use("/api/v1/attendance", attendanceRoutes);
app.use("/api/v1/communities", communityRoutes);
app.use("/api/v1/announcements", announcementRoutes);
app.use("/api/v1/payments", paymentRoutes);

//Error Handlers
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
