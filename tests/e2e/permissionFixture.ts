import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const ROOT = resolve('docs/artifacts/permission-fixtures');
const PREFIX = join(ROOT, 'deck-permission-');

export async function createPermissionFixture(
  permission: 'tabs' | 'tabGroups',
) {
  await mkdir(ROOT, { recursive: true });
  const path = await mkdtemp(PREFIX);
  if (!path.startsWith(PREFIX) || !path.startsWith(ROOT + sep))
    throw new Error('Test fixture escaped artifact directory');
  const extensionPath = join(path, 'dist');
  await cp(resolve('apps/extension/dist'), extensionPath, { recursive: true });
  // Native grant acceptance is an owner check. Only this disposable test
  // copy pregrants access; production keeps the permission optional.
  const file = join(extensionPath, 'manifest.json');
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  manifest.permissions = [...manifest.permissions, permission];
  manifest.optional_permissions = manifest.optional_permissions.filter(
    (value: string) => value !== permission,
  );
  await writeFile(file, JSON.stringify(manifest));
  return path;
}

export async function removePermissionFixture(path: string) {
  const target = resolve(path);
  if (!target.startsWith(PREFIX) || !target.startsWith(ROOT + sep))
    throw new Error('Test fixture escaped artifact directory');
  await rm(target, { recursive: true, force: true });
}
