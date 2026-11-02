import { setActiveDatabase } from '../../src/database/connection.js';
import { JsonDatabase } from '../../src/database/jsonStore.js';
import { deepCloneRecord } from '../../src/database/models/schemaHelpers.js';
import { createJsonRepositories } from '../../src/database/repositories/index.js';

/**
 * Creates a full in-memory transactional CAS repository suite using the exact production
 * `JsonDatabase` and `createJsonRepositories` implementation.
 */
export function createInMemoryRepositories(initialSnapshot = null) {
  const db = new JsonDatabase({ inMemory: true });
  db.initialized = true;
  setActiveDatabase(db);

  if (initialSnapshot) {
    db.store = deepCloneRecord(initialSnapshot);
  }

  const repos = createJsonRepositories(db);
  return {
    ...repos,
    exportSnapshot: () => db.exportSnapshot(),
    setSimulateFailure: (flag) => db.setSimulateFailure(flag),
  };
}
