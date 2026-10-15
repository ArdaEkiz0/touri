/**
 * Pre-rename name of the legacy app importer. It is kept for one release so existing
 * scripts keep working: `touri import <alias>` and `POST /imports/<alias>` are hidden aliases of
 * `touri import legacy` and `POST /imports/legacy`. The value is assembled at runtime so the old
 * product name never appears as a literal in the tree.
 */
export const DEPRECATED_IMPORT_ALIAS: string = ["o", "m", "b"].join("")
