import { SCHEMA_VERSION } from 'deck-schema/constants';

import { parseDocument, type DeckDocument } from './document';

type VersionedDocument = { schemaVersion?: unknown };
type Migration = (document: unknown) => unknown;

// v1 already stored Inbox pins and soft-deletion fields. v2 records that
// established shape and exercises an atomic database upgrade.
const DEFAULT_MIGRATIONS = new Map<number, Migration>([
  [1, (value) => ({ ...(value as object), schemaVersion: 2 })],
]);

export function migrateDocument(
  value: unknown,
  migrations: ReadonlyMap<number, Migration> = new Map(),
): DeckDocument {
  let copy: unknown = structuredClone(value);
  const initialVersion = (copy as VersionedDocument)?.schemaVersion;
  if (!Number.isInteger(initialVersion))
    throw new Error('Missing schemaVersion');
  let version = Number(initialVersion);
  if (version > SCHEMA_VERSION)
    throw new Error('Export uses a newer schema version');
  const path = new Map([...DEFAULT_MIGRATIONS, ...migrations]);
  while (version < SCHEMA_VERSION) {
    const migrate = path.get(version);
    if (!migrate)
      throw new Error(`No migration from schema version ${version}`);
    copy = structuredClone(migrate(structuredClone(copy)));
    const nextVersion = (copy as VersionedDocument)?.schemaVersion;
    if (nextVersion !== version + 1)
      throw new Error(
        `Migration ${version} did not advance exactly one version`,
      );
    version += 1;
  }
  return parseDocument(copy);
}
