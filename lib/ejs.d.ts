declare var ejs: any

/**
 * Thrown when a template fails to render. PocketBase API errors
 * (BadRequestError, NotFoundError, ...) are not wrapped and pass through as-is.
 */
export class EjsError extends Error {
  name: 'EjsError'
  /** Error message, prefixed with `filename:line` and the surrounding template source */
  message: string
  stack: string
  /** Escaped template file name */
  path: string
  filename: string
  /** Template line of the failure (exact within multi-line `<% %>` blocks when the stack allows) */
  line: number
  /** Column in the generated code, or null when unknown */
  col: number | null
  /** Template source around `line`, with the failing line marked `>>` */
  context: string
  /** `status` of the original error, or 500 */
  status: number
  originalError: Error
  cause: Error
}

export default ejs
