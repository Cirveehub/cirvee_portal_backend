import { PrismaClient, UserRole } from "@prisma/client";

import * as bcrypt from "bcryptjs";

const prisma = new PrismaClient();

console.log("!!! SEED FILE LOADED !!!");

async function main() {
  console.log(" Starting seed...");

  // 1. Create Default Department
  const existingDept = await prisma.department.findUnique({
    where: { name: "Administration" },
  });

  let adminDept;
  if (!existingDept) {
    adminDept = await prisma.department.create({
      data: {
        name: "Administration",
        description: "System Management and Governance",
      },
    });
    console.log("Created default department: Administration");
  } else {
    adminDept = existingDept;
    console.log("Department already exists: Administration");
  }

  // 2. Create Initial Admin User
  const existingUser = await prisma.user.findUnique({
    where: { email: "admin@cirvee.com" },
  });

  let user;
  if (!existingUser) {
    const hashedPassword = await bcrypt.hash("Admin@123", 10);
    user = await prisma.user.create({
      data: {
        email: "admin@cirvee.com",
        password: hashedPassword,
        firstName: "System",
        lastName: "Administrator",
        role: UserRole.SUPER_ADMIN,
        isEmailVerified: true,
      },
    });
    console.log(`Created Super Admin: ${user.email}`);
  } else {
    user = existingUser;
    console.log(`Super Admin already exists: ${user.email}`);
  }

  // 3. Create/Check Admin Profile
  const existingAdminProfile = await prisma.admin.findUnique({
    where: { userId: user.id },
  });

  if (!existingAdminProfile) {
    const adminProfile = await prisma.admin.create({
      data: {
        userId: user.id,
        staffId: "CIRVEE-001",
        departmentId: adminDept.id,
        permissions: ["ALL"],
      },
    });
    console.log(`Created Admin Profile: ${adminProfile.staffId}`);
  } else {
    console.log(`Admin Profile already exists: ${existingAdminProfile.staffId}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
