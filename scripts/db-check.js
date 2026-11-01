import dotenv from 'dotenv';
import { connectDatabase, checkDatabaseHealth, disconnectDatabase } from '../src/database/connection.js';
import * as Models from '../src/database/models/index.js';
import { sanitizeErrorMessage } from '../src/utils/errors.js';

dotenv.config({ quiet: true });

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri || !/^mongodb(\+srv)?:\/\//.test(uri)) {
    console.error('[ERROR] Missing or invalid MONGODB_URI in environment/.env.');
    process.exit(1);
  }

  try {
    await connectDatabase(uri, { serverSelectionTimeoutMS: 8000 });
    const health = await checkDatabaseHealth();
    console.log(
      `[OK] MongoDB connected (latency: ${health.latencyMs}ms, transactionsSupported: ${health.transactionsSupported}).`,
    );

    const modelList = Object.values(Models).filter((m) => typeof m?.syncIndexes === 'function');
    for (const model of modelList) {
      await model.createIndexes();
      console.log(`  - Verified indexes on collection: ${model.collection.collectionName}`);
    }
    console.log('[OK] All Mongoose schema indexes verified.');
  } catch (err) {
    console.error(`[ERROR] Database check failed: ${sanitizeErrorMessage(err.message)}`);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

main();
