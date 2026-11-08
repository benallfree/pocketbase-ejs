# pocketbase-ejs

## 7.0.2001

### Major Changes

- Synced with upstream EJS v7.0.2 (from v3.1.10). Upstream highlights:
  - Template locals no longer resolve through the prototype chain (prototype-pollution hardening); opt back in with `unsafePrototypeLocals: true`
  - Options are no longer read from the data object; pass them as the options argument
  - The `client` option was removed
  - Whitespace-slurp tags work with custom delimiters; fixes for empty includer templates, nullish `renderFile` data and literal tags with unusual delimiters
  - About 1.6x faster template compilation
- Source now lives in `lib/esm/ejs.js`; `lib/cjs/ejs.js` (what `require()` loads) is generated from it
- Render errors are now thrown as `EjsError` (exported as `ejs.EjsError`) with `line`, `col`, `context`, `path`, `status` and `originalError`. The message still starts with `file:line` and the surrounding source, and ends with the original error type and message
- Error line numbers are now exact inside multi-line `<% %>` blocks (previously could be off by one or point at the block start)
- PocketBase API errors (`BadRequestError`, `NotFoundError`, `ForbiddenError`, `UnauthorizedError`, `TooManyRequestsError`, `InternalServerError`, `ApiError`) pass through templates unwrapped
- Removed debug `console.log` output from error handling

## 3.1.10006

### Patch Changes

- Feat: export includeFile for post-processing capabilities such as Markdown

## 3.1.10005

### Patch Changes

- Fix: improved handling of BadRequestError

## 3.1.10004

### Patch Changes

- Enh: line number reporting in JS blocks

## 3.1.10003

### Patch Changes

- Add support for 'prepend' template option

## 3.1.10002

### Patch Changes

- 0982f06: Readme update
- 0982f06: Added @types/ejs

## 3.1.10001

### Patch Changes

- f5aebbc: Initial release: removed async features an everything except cjs support
- Converted to upstream anchoring
