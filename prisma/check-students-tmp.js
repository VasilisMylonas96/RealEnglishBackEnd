const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
async function main() {
  const byRole = await p.user.groupBy({ by: ['role'], _count: { _all: true } });
  console.log('USERS BY ROLE:', JSON.stringify(byRole));
  const students = await p.user.findMany({
    where: { role: 'STUDENT' },
    select: { id: true, username: true, firstName: true, lastName: true, level: true },
    take: 30,
  });
  console.log('STUDENTS:', JSON.stringify(students, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
