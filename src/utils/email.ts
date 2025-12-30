import nodemailer from "nodemailer";
import logger from "./logger";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

export class EmailUtil {
  static async sendVerificationEmail(
    email: string,
    name: string,
    otp: string
  ): Promise<void> {
    try {
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: "Verify Your Email - Cirvee Portal",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Welcome to Cirvee Portal, ${name}!</h2>
            <p>Thank you for signing up. Please use the following OTP to verify your email:</p>
            <div style="background: #f4f4f4; padding: 20px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 5px; margin: 20px 0;">
              ${otp}
            </div>
            <p style="color: #666;">This OTP will expire in 10 minutes.</p>
            <p style="color: #666;">If you didn't request this, please ignore this email.</p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`Verification email sent to ${email}`);
    } catch (error) {
      logger.error("Error sending verification email:", error);
      throw new Error("Failed to send verification email");
    }
  }

  static async sendPasswordResetEmail(
    email: string,
    name: string,
    resetToken: string
  ): Promise<void> {
    try {
      const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: "Reset Your Password - Cirvee Portal",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Password Reset Request</h2>
            <p>Hello ${name},</p>
            <p>You requested to reset your password. Click the button below to proceed:</p>
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" style="background: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                Reset Password
              </a>
            </div>
            <p style="color: #666;">This link will expire in 1 hour.</p>
            <p style="color: #666;">If you didn't request this, please ignore this email.</p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`Password reset email sent to ${email}`);
    } catch (error) {
      logger.error("Error sending password reset email:", error);
      throw new Error("Failed to send password reset email");
    }
  }

  static async sendWelcomeEmail(
    email: string,
    name: string,
    studentId: string
  ): Promise<void> {
    try {
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: "Welcome to Cirvee Portal!",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">Welcome to Cirvee Portal!</h2>
            <p>Hello ${name},</p>
            <p>Your account has been successfully created. Here are your details:</p>
            <div style="background: #f4f4f4; padding: 20px; margin: 20px 0;">
              <p><strong>Student ID:</strong> ${studentId}</p>
              <p><strong>Email:</strong> ${email}</p>
            </div>
            <p>You can now log in using your Student ID and password.</p>
            <p>If you have any questions, feel free to contact our support team.</p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`Welcome email sent to ${email}`);
    } catch (error) {
      logger.error("Error sending welcome email:", error);
    }
  }
static async sendStaffCredentialsEmail(
  email: string,
  name: string,
  staffId: string,
  password: string,
  role: string
): Promise<void> {
  try {
    const mailOptions = {
      from: process.env.EMAIL_FROM,
      to: email,
      subject: `Your ${role} Account Credentials - Cirvee Portal`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Welcome to the Team, ${name}!</h2>
          <p>An account has been created for you as a <strong>${role}</strong>.</p>
          <div style="background: #f4f4f4; padding: 20px; margin: 20px 0; border-left: 4px solid #007bff;">
            <p><strong>Staff ID:</strong> ${staffId}</p>
            <p><strong>Email:</strong> ${email}</p>
            <p><strong>Temporary Password:</strong> <span style="font-family: monospace; font-size: 1.2em;">${password}</span></p>
          </div>
          <p>Please log in and change your password immediately for security reasons.</p>
          <p style="color: #666;">If you didn't expect this email, please contact IT support.</p>
        </div>
      `,
    };

    await transporter.sendMail(mailOptions);
    logger.info(`Credentials email sent to ${email}`);
  } catch (error) {
    logger.error("Error sending credentials email:", error);

  }
}
  static async sendPaymentReminderEmail(
    email: string,
    firstName: string,
    courseTitle: string,
    balanceKobo: number,
    dueDate?: Date
  ): Promise<void> {
    try {
      const formattedBalance = `₦${(balanceKobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const dueDateStr = dueDate ? new Date(dueDate).toLocaleDateString() : "ASAP";
      const paymentLink = `${process.env.FRONTEND_URL}/dashboard/payments`;

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: `Payment Reminder: Outstanding Balance for ${courseTitle}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #d9534f;">Outstanding Payment Reminder</h2>
            <p>Hello ${firstName},</p>
            <p>This is a reminder that you have an outstanding balance for your course <strong>${courseTitle}</strong>.</p>
            <div style="background: #fdf2f2; padding: 20px; border-left: 4px solid #d9534f; margin: 20px 0;">
              <p><strong>Outstanding Balance:</strong> ${formattedBalance}</p>
              <p><strong>Due Date:</strong> ${dueDateStr}</p>
            </div>
            <p>Please clear your balance to avoid any disruption to your access, as you have completed over 40% of the course duration.</p>
            <p>If you have already made payment, please ignore this message or contact support.</p>
            <br/>
            <a href="${paymentLink}" style="background: #d9534f; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Make Payment</a>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`Payment reminder email sent to ${email}`);
    } catch (error) {
      logger.error("Error sending payment reminder email:", error);
    }
  }
  static async sendAssignmentCreatedEmail(
    email: string,
    studentName: string,
    assignmentTitle: string,
    courseTitle: string,
    dueDate: Date
  ): Promise<void> {
    try {
      const dueDateStr = new Date(dueDate).toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      const assignmentUrl = `${process.env.FRONTEND_URL}/dashboard/assignments`;

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: `New Assignment: ${assignmentTitle}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #007bff;">New Assignment Posted</h2>
            <p>Hello ${studentName},</p>
            <p>A new assignment <strong>${assignmentTitle}</strong> has been posted for your course <strong>${courseTitle}</strong>.</p>
            <div style="background: #e9f5ff; padding: 20px; border-left: 4px solid #007bff; margin: 20px 0;">
              <p><strong>Due Date:</strong> ${dueDateStr}</p>
            </div>
            <p>Please log in to the portal to view details and submit your work.</p>
            <br/>
            <a href="${assignmentUrl}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">View Assignment</a>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`Assignment email sent to ${email}`);
    } catch (error) {
      logger.error("Error sending assignment email:", error);
    }
  }

  static async sendAnnouncementEmail(
    email: string,
    name: string,
    title: string,
    content: string,
    senderName: string
  ): Promise<void> {
    try {
      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: `Announcement: ${title}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #333;">New Announcement</h2>
            <p>Hello ${name},</p>
            <p><strong>${senderName}</strong> posted a new announcement:</p>
            <div style="background: #f9f9f9; padding: 20px; border: 1px solid #ddd; margin: 20px 0; border-radius: 5px;">
              <h3 style="margin-top: 0;">${title}</h3>
              <p style="white-space: pre-wrap;">${content}</p>
            </div>
            <p>Log in to the portal to view more details or reply if applicable.</p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);
      logger.info(`Announcement email sent to ${email}`);
    } catch (error) {
      logger.error("Error sending announcement email:", error);
    }
  }
}
