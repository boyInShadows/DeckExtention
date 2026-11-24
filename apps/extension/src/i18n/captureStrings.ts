import { captureStrings as english } from './en/captureStrings';
import { captureStrings as persian } from './fa/captureStrings';
import { createCatalog } from './language';
import type { CaptureCatalog } from './catalogs';

export const captureStrings = createCatalog<CaptureCatalog>(english, persian);
