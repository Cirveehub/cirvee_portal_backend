import bcrypt from "bcryptjs";
import prisma from "@config/database";
import { IdGenerator } from "../../utils/idGenerator";
import { QueueService } from "../../services/queue.service";
import { OtpUtil } from "../../utils/otp";
import { TokenUtil } from "../../utils/token";
import { UserRole } from "@prisma/client";
import logger from "../../utils/logger";

export class AuthService {
  //  STUDENT SIGNUP
  static async studentSignup(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phoneNumber?: string;
    courseCode: string;
  }) {
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      throw new Error("Email already registered");
    }

    // Generate student ID
    const studentId = await IdGenerator.generateStudentId(data.courseCode);

    const hashedPassword = await bcrypt.hash(data.password, 12);

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          password: hashedPassword,
          firstName: data.firstName,
          lastName: data.lastName,
          phoneNumber: data.phoneNumber,
          role: UserRole.STUDENT,
        },
      });

      const student = await tx.student.create({
        data: {
          userId: user.id,
          studentId,
        },
      });

      return { user, student };
    });

    // Generate and send OTP
    const otp = OtpUtil.generate();
    await OtpUtil.save(data.email, otp);
    await QueueService.addEmailJob({
      type: "VERIFICATION",
      payload: { email: data.email, name: data.firstName, otp }
    });

    logger.info(`Student signup: ${studentId} - ${data.email}`);

    return {
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
      },
      studentId,
      message: "Signup successful. Please verify your email with the OTP sent.",
    };
  }

  //  VERIFY OTP
  static async verifyOtp(email: string, otp: string) {
    const isValid = await OtpUtil.verify(email, otp);

    if (!isValid) {
      throw new Error("Invalid or expired OTP");
    }

    const user = await prisma.user.update({
      where: { email },
      data: { isEmailVerified: true },
      include: {
        student: true,
      },
    });

    if (user.student) {
      await QueueService.addEmailJob({
        type: "WELCOME",
        payload: { email, name: user.firstName, studentId: user.student.studentId }
      });
    }

    const accessToken = TokenUtil.generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const refreshToken = TokenUtil.generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    await TokenUtil.saveRefreshToken(user.id, refreshToken);

    logger.info(`Email verified: ${email}`);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        studentId: user.student?.studentId,
      },
      accessToken,
      refreshToken,
    };
  }

  //  STUDENT LOGIN
  static async studentLogin(studentId: string, password: string) {
    // Find student
    const student = await prisma.student.findUnique({
      where: { studentId },
      include: {
        user: true,
      },
    });

    if (!student) {
      throw new Error("Invalid student ID or password");
    }

    // Check if user is active
    if (!student.user.isActive) {
      throw new Error("Account is deactivated. Contact support.");
    }

    // Verify password
    if (!student.user.password) {
      throw new Error("Please use Google Sign-In or reset your password");
    }

    const isPasswordValid = await bcrypt.compare(
      password,
      student.user.password
    );

    if (!isPasswordValid) {
      throw new Error("Invalid student ID or password");
    }

    if (!student.user.isEmailVerified) {
      throw new Error("Please verify your email first");
    }

    // Update last login
    await prisma.user.update({
      where: { id: student.user.id },
      data: { lastLogin: new Date() },
    });

    // Generate tokens
    const accessToken = TokenUtil.generateAccessToken({
      id: student.user.id,
      email: student.user.email,
      role: student.user.role,
    });

    const refreshToken = TokenUtil.generateRefreshToken({
      id: student.user.id,
      email: student.user.email,
      role: student.user.role,
    });

    await TokenUtil.saveRefreshToken(student.user.id, refreshToken);

    logger.info(`Student login: ${studentId}`);

    return {
      user: {
        id: student.user.id,
        email: student.user.email,
        firstName: student.user.firstName,
        lastName: student.user.lastName,
        role: student.user.role,
        studentId: student.studentId,
      },
      accessToken,
      refreshToken,
    };
  }

  //  ADMIN/TUTOR LOGIN
  static async staffLogin(identifier: string, password: string) {
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: identifier },
          { admin: { staffId: identifier } },
          { tutor: { staffId: identifier } },
        ],
      },
      include: {
        admin: true,
        tutor: true,
      },
    });

    logger.info("Login user:", user);

    if (!user || user.role === UserRole.STUDENT) {
      throw new Error("Invalid Credentials");
    }

    if (!user.isActive) {
      throw new Error("Account is deactivated. Contact support.");
    }

    if (!user.password) {
      throw new Error("Password not set. Contact admin.");
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error("Invalid Credentials");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    const accessToken = TokenUtil.generateAccessToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    const refreshToken = TokenUtil.generateRefreshToken({
      id: user.id,
      email: user.email,
      role: user.role,
    });

    await TokenUtil.saveRefreshToken(user.id, refreshToken);

    logger.info(`Staff login: ${user.email} (Role: ${user.role}, ID: ${identifier})`);

    return {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        staffId: user.admin?.staffId || user.tutor?.staffId,
      },
      accessToken,
      refreshToken,
    };
  }

  //  GOOGLE OAUTH
  // static async googleAuth(profile: any) {
  //   const email = profile.emails[0].value;
  //   const googleId = profile.id;

  //   let user = await prisma.user.findUnique({
  //     where: { email },
  //     include: { student: true },
  //   });

  //   if (user) {
  //     // Update google ID if not set
  //     if (!user.googleId) {
  //       user = await prisma.user.update({
  //         where: { id: user.id },
  //         data: { googleId, isEmailVerified: true },
  //         include: { student: true },
  //       });
  //     }
  //   } else {
  //     // Create new student account
  //     const studentId = await IdGenerator.generateStudentId("GEN");

  //     const result = await prisma.$transaction(async (tx) => {
  //       const newUser = await tx.user.create({
  //         data: {
  //           email,
  //           googleId,
  //           firstName: profile.name.givenName,
  //           lastName: profile.name.familyName,
  //           profileImage: profile.photos[0]?.value,
  //           role: UserRole.STUDENT,
  //           isEmailVerified: true,
  //         },
  //       });

  //       const student = await tx.student.create({
  //         data: {
  //           userId: newUser.id,
  //           studentId,
  //         },
  //       });

  //       return { user: newUser, student };
  //     });

  //     user = { ...result.user, student: result.student };

  //     await EmailUtil.sendWelcomeEmail(
  //       email,
  //       user.firstName,
  //       result.student.studentId
  //     );
  //   }

  //   await prisma.user.update({
  //     where: { id: user.id },
  //     data: { lastLogin: new Date() },
  //   });

  //   const accessToken = TokenUtil.generateAccessToken({
  //     id: user.id,
  //     email: user.email,
  //     role: user.role,
  //   });

  //   const refreshToken = TokenUtil.generateRefreshToken({
  //     id: user.id,
  //     email: user.email,
  //     role: user.role,
  //   });

  //   await TokenUtil.saveRefreshToken(user.id, refreshToken);

  //   logger.info(`Google auth: ${email}`);

  //   return {
  //     user: {
  //       id: user.id,
  //       email: user.email,
  //       firstName: user.firstName,
  //       lastName: user.lastName,
  //       role: user.role,
  //       studentId: user.student?.studentId,
  //     },
  //     accessToken,
  //     refreshToken,
  //   };
  // }

  static async refreshToken(refreshToken: string) {
    try {
      const payload = TokenUtil.verifyRefreshToken(refreshToken);

      const storedToken = await TokenUtil.getRefreshToken(payload.id);

      if (!storedToken || storedToken !== refreshToken) {
        throw new Error("Invalid refresh token");
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
      });

      if (!user || !user.isActive) {
        throw new Error("User not found or deactivated");
      }

      const newAccessToken = TokenUtil.generateAccessToken({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      const newRefreshToken = TokenUtil.generateRefreshToken({
        id: user.id,
        email: user.email,
        role: user.role,
      });

      await TokenUtil.saveRefreshToken(user.id, newRefreshToken);

      return {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error: any) {
      throw new Error("Invalid or expired refresh token");
    }
  }

  //  FORGOT PASSWORD
  static async forgotPassword(email: string) {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return {
        message: "If email exists, password reset link has been sent",
      };
    }

    const resetToken = TokenUtil.generatePasswordResetToken();
    await TokenUtil.savePasswordResetToken(email, resetToken);

    await QueueService.addEmailJob({
      type: "PASSWORD_RESET",
      payload: { email, name: user.firstName, resetToken }
    });

    logger.info(`Password reset requested: ${email}`);

    return {
      message: "Password reset link sent to your email",
    };
  }

  //  RESET PASSWORD
  static async resetPassword(token: string, newPassword: string) {
    // Token format: email:token (we'll need to get email somehow)
    const user = await prisma.user.findFirst({
      where: {
        email: {
          not: undefined,
        },
      },
    });

    if (!user) {
      throw new Error("Invalid reset token");
    }

    const isValid = await TokenUtil.verifyPasswordResetToken(user.email, token);

    if (!isValid) {
      throw new Error("Invalid or expired reset token");
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);

    await prisma.user.update({
      where: { email: user.email },
      data: { password: hashedPassword },
    });

    logger.info(`Password reset successful: ${user.email}`);

    return {
      message: "Password reset successful",
    };
  }

  //  RESEND OTP
  static async resendOtp(email: string) {
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new Error("Email not found");
    }

    if (user.isEmailVerified) {
      throw new Error("Email already verified");
    }

    const otp = OtpUtil.generate();
    await OtpUtil.save(email, otp);
    await QueueService.addEmailJob({
      type: "VERIFICATION",
      payload: { email, name: user.firstName, otp }
    });

    logger.info(`OTP resent: ${email}`);

    return {
      message: "OTP sent successfully",
    };
  }

  // LOGOUT
  static async logout(userId: string) {
    await TokenUtil.deleteRefreshToken(userId);
    logger.info(`User logged out: ${userId}`);
    return { message: "Logged out successfully" };
  }
}
