/* eslint-disable no-console */
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Seeds the AI provider API keys into the AiApiKey table (provider/site/apiKey).
 * Idempotent: upserts by provider. This table has NO API endpoint — it is
 * inspected/edited in the DB only.
 */
const KEYS = [
  {
    provider: 'gemini',
    site: 'https://aistudio.google.com/app/apikey',
    apiKey: process.env.GEMINI_API_KEY || '',
  },
  {
    provider: 'groq',
    site: 'https://console.groq.com/keys',
    apiKey: process.env.GROQ_API_KEY || '',
  },
  {
    provider: 'openrouter',
    site: 'https://openrouter.ai/workspaces/default/keys',
    apiKey: process.env.OPENROUTER_API_KEY || '',
  },
];

async function main() {
  for (const k of KEYS) {
    if (!k.apiKey) {
      console.warn(`Skipping ${k.provider}: no key in env`);
      continue;
    }
    await prisma.aiApiKey.upsert({
      where: { provider: k.provider },
      create: { provider: k.provider, site: k.site, apiKey: k.apiKey },
      update: { site: k.site, apiKey: k.apiKey },
    });
    console.log(`Seeded ${k.provider} key (${k.site})`);
  }
  const rows = await prisma.aiApiKey.findMany({ orderBy: { provider: 'asc' } });
  console.log(`\nAiApiKey rows: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.provider.padEnd(11)} ${r.site}  key=${r.apiKey.slice(0, 8)}...`);
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
