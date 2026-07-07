const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Let's print all resumes in the database
  const resumes = await prisma.resume.findMany();
  console.log(`Found ${resumes.length} resumes in database:`);
  for (const r of resumes) {
    console.log(`- ID: ${r.id}, Name: ${r.name}, Source: ${r.source}`);
    // If it's Zakariya's resume, let's inspect the details
    if (r.name && r.name.toLowerCase().includes('zakariya')) {
      console.log("Details for Zakariya's resume:");
      // Since it's stored as JSON or fields, let's print the whole object
      console.log(JSON.stringify(r, null, 2));
    }
  }
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
