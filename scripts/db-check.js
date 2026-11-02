import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { connectDatabase, disconnectDatabase, pingDatabase } from '../src/database/connection.js';

dotenv.config({ quiet: true });

async function main() {
  const dataDir = path.resolve(process.env.DATA_DIR || './data');
  try {
    await connectDatabase(dataDir);
    const health = await pingDatabase();
    const files = (await fs.readdir(dataDir)).filter((f) => f.endsWith('.json'));
    console.log(`[OK] Local JSON database verified at ${health.dataDir}`);
    console.log(`[OK] Initialized & validated ${files.length} JSON collections: ${files.join(', ')}`);
  } catch (err) {
    console.error(`[ERROR] JSON storage check failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

main();
