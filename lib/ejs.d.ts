declare var ejs: any;

export class EjsError extends Error {
  constructor(err: Error, str: string, flnm: string, lineno: number, esc: (str: string) => string, prependLines: number);
  message: string;
  stack: string;
  line: number;
  col: number;
  context: string;
  path: string;
}

export default ejs;
