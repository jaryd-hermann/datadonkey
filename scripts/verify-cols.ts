import { prisma } from "../src/lib/db";
async function main() {
  const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'Meeting' AND column_name IN ('welcomed','armedUntil','lastTriggerAt','conversation')
  `;
  console.log(rows.map((r) => r.column_name));
  process.exit(0);
}
main();
