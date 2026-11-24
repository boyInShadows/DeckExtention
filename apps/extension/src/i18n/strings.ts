import { strings as english } from './en/strings';
import { strings as persian } from './fa/strings';
import { createCatalog } from './language';
import type { SurfaceCatalog } from './catalogs';

export const strings = createCatalog<SurfaceCatalog>(english, persian);
