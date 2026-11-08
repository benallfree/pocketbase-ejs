/*
 * EJS Embedded JavaScript templates
 * Copyright 2112 Matthew Eernisse (mde@fleegix.org)
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
*/

'use strict';

// pocketbase-ejs: JSVM has no Node builtins; pocketbase-node provides fs/path shims
import { fs, path } from 'pocketbase-node';
import utils from './utils.js';

/**
 * @file Embedded JavaScript templating engine. {@link http://ejs.co}
 * @author Matthew Eernisse <mde@fleegix.org>
 * @project EJS
 * @license {@link http://www.apache.org/licenses/LICENSE-2.0 Apache License, Version 2.0}
 */

/**
 * EJS internal functions.
 *
 * Technically this "module" lies in the same file as {@link module:ejs}, for
 * the sake of organization all the private functions re grouped into this
 * module.
 *
 * @module ejs-internal
 * @private
 */

/**
 * Embedded JavaScript templating engine.
 *
 * @module ejs
 * @public
 */

// Keyword used in code generation -- updated to 'var' in CJS build
const DECLARATION_KEYWORD = 'let';

const ejs = {};

/** @type {string} */
let _DEFAULT_OPEN_DELIMITER = '<';
let _DEFAULT_CLOSE_DELIMITER = '>';
let _DEFAULT_DELIMITER = '%';
let _DEFAULT_LOCALS_NAME = 'locals';
let _REGEX_STRING = '(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)';
let _BOM = /^\uFEFF/;
let _JS_IDENTIFIER = /^[a-zA-Z_$][0-9a-zA-Z_$]*$/;

/**
 * EJS template function cache. This can be a LRU object from lru-cache NPM
 * module. By default, it is {@link module:utils.cache}, a simple in-process
 * cache that grows continuously.
 *
 * @type {Cache}
 */

ejs.cache = utils.cache;

/**
 * Custom file loader. Useful for template preprocessing or restricting access
 * to a certain part of the filesystem.
 *
 * @type {fileLoader}
 */

ejs.fileLoader = fs.readFileSync;

/**
 * Name of the object containing the locals.
 *
 * This variable is overridden by {@link Options}`.localsName` if it is not
 * `undefined`.
 *
 * @type {String}
 * @public
 */

ejs.localsName = _DEFAULT_LOCALS_NAME;

/**
 * Promise implementation -- defaults to the native implementation if available
 * This is mostly just for testability
 *
 * @type {PromiseConstructorLike}
 * @public
 */

ejs.promiseImpl = (new Function('return this;'))().Promise;

/**
 * Get the path to the included file from the parent file path and the
 * specified path.
 *
 * @param {String}  name     specified path
 * @param {String}  filename parent file path
 * @param {Boolean} [isDir=false] whether the parent file path is a directory
 * @return {String}
 */
ejs.resolveInclude = function(name, filename, isDir) {
  let dirname = path.dirname;
  let extname = path.extname;
  let resolve = path.resolve;
  let includePath = resolve(isDir ? filename : dirname(filename), name);
  let ext = extname(name);
  if (!ext) {
    includePath += '.ejs';
  }
  return includePath;
};

/**
 * Try to resolve file path on multiple directories
 *
 * @param  {String}        name  specified path
 * @param  {Array<String>} paths list of possible parent directory paths
 * @return {String}
 */
function resolvePaths(name, paths) {
  let filePath;
  if (paths.some(function (v) {
    filePath = ejs.resolveInclude(name, v, true);
    return fs.existsSync(filePath);
  })) {
    return filePath;
  }
}

/**
 * Get the path to the included file by Options
 *
 * @param  {String}  path    specified path
 * @param  {Options} options compilation options
 * @return {String}
 */
function getIncludePath(path, options) {
  let includePath;
  let filePath;
  let views = options.views;
  let match = /^[A-Za-z]+:\\|^\//.exec(path);

  // Abs path
  if (match && match.length) {
    path = path.replace(/^\/*/, '');
    if (Array.isArray(options.root)) {
      includePath = resolvePaths(path, options.root);
    } else {
      includePath = ejs.resolveInclude(path, options.root || '/', true);
    }
  }
  // Relative paths
  else {
    // Look relative to a passed filename first
    if (options.filename) {
      filePath = ejs.resolveInclude(path, options.filename);
      if (fs.existsSync(filePath)) {
        includePath = filePath;
      }
    }
    // Then look in any views directories
    if (!includePath && Array.isArray(views)) {
      includePath = resolvePaths(path, views);
    }
    if (!includePath && typeof options.includer !== 'function') {
      throw new Error('Could not find the include file "' +
          options.escapeFunction(path) + '"');
    }
  }
  return includePath;
}

/**
 * Get the template from a string or a file, either compiled on-the-fly or
 * read from cache (if enabled), and cache the template if needed.
 *
 * If `template` is not set, the file specified in `options.filename` will be
 * read.
 *
 * If `options.cache` is true, this function reads the file from
 * `options.filename` so it must be set prior to calling this function.
 *
 * @memberof module:ejs-internal
 * @param {Options} options   compilation options
 * @param {String} [template] template source
 * @return {TemplateFunction}
 * @static
 */

function handleCache(options, template) {
  let func;
  let filename = options.filename;
  let hasTemplate = arguments.length > 1;

  if (options.cache) {
    if (!filename) {
      throw new Error('cache option requires a filename');
    }
    func = ejs.cache.get(filename);
    if (func) {
      return func;
    }
    if (!hasTemplate) {
      template = fileLoader(filename).toString().replace(_BOM, '');
    }
  }
  else if (!hasTemplate) {
    // istanbul ignore if: should not happen at all
    if (!filename) {
      throw new Error('Internal EJS error: no file name or template '
                    + 'provided');
    }
    template = fileLoader(filename).toString().replace(_BOM, '');
  }
  func = ejs.compile(template, options);
  if (options.cache) {
    ejs.cache.set(filename, func);
  }
  return func;
}

/**
 * fileLoader is independent
 *
 * @param {String} filePath ejs file path.
 * @return {String} The contents of the specified file.
 * @static
 */

function fileLoader(filePath){
  return ejs.fileLoader(filePath);
}

/**
 * Get the template function.
 *
 * If `options.cache` is `true`, then the template is cached.
 *
 * @memberof module:ejs-internal
 * @param {String}  path    path for the specified file
 * @param {Options} options compilation options
 * @return {TemplateFunction}
 * @static
 */

// pocketbase-ejs: exported so callers can wrap it (see the `includeFile` option)
ejs.includeFile = function includeFile(path, options) {
  let opts = utils.shallowCopy(utils.createNullProtoObjWherePossible(), options);
  opts.filename = getIncludePath(path, opts);
  if (typeof options.includer === 'function') {
    let includerResult = options.includer(path, opts.filename);
    if (includerResult) {
      if (includerResult.filename) {
        opts.filename = includerResult.filename;
      }
      // An empty string is a valid (empty) template, not "no template"
      if (includerResult.template || includerResult.template === '') {
        return handleCache(opts, includerResult.template);
      }
    }
  }
  return handleCache(opts);
};

// pocketbase-ejs: PocketBase API errors (BadRequestError, NotFoundError, ...) carry
// an HTTP status the caller acts on, so they pass through templates unwrapped.
const PASSTHROUGH_ERROR_NAMES = ['ApiError', 'BadRequestError', 'ForbiddenError',
  'NotFoundError', 'UnauthorizedError', 'TooManyRequestsError', 'InternalServerError'];

function isPassthroughError(err) {
  const g = (new Function('return this;'))();
  return PASSTHROUGH_ERROR_NAMES.some(function (name) {
    return typeof g[name] === 'function' && err instanceof g[name];
  });
}

// Finds the line/column of the innermost frame of a generated template function.
// goja reports these as `<eval>:L:C`; V8 as `<anonymous>:L:C` (or the sourceURL).
function stackLocation(stack, filename) {
  if (typeof stack !== 'string') {
    return null;
  }
  let patterns = [/<eval>:(\d+):(\d+)/];
  if (filename) {
    // V8 reports the `//# sourceURL` as written, i.e. JSON-quoted
    patterns.push(new RegExp('"?' + utils.escapeRegExpChars(filename) + '"?:(\\d+):(\\d+)'));
  }
  patterns.push(/<anonymous>:(\d+):(\d+)/);
  for (let i = 0; i < patterns.length; i++) {
    let match = stack.match(patterns[i]);
    if (match) {
      return {line: parseInt(match[1], 10), col: parseInt(match[2], 10)};
    }
  }
  return null;
}

// Number of lines the engine's `new Function()` wrapper puts before the body.
let FUNCTION_WRAPPER_LINES = null;
function functionWrapperLines() {
  if (FUNCTION_WRAPPER_LINES === null) {
    FUNCTION_WRAPPER_LINES = 2;
    try {
      new Function('a', 'throw new Error("probe");')();
    }
    catch (e) {
      let loc = stackLocation(e && e.stack);
      if (loc) {
        FUNCTION_WRAPPER_LINES = loc.line - 1;
      }
    }
  }
  return FUNCTION_WRAPPER_LINES;
}

/**
 * Error thrown when a template fails to render. Carries the template location
 * and surrounding source so callers can render a useful error page.
 *
 * @param {Error}  err      original error
 * @param {String} str      EJS source
 * @param {String} flnm     file name of the EJS file
 * @param {Number} lineno   template line of the failing tag, as tracked by EJS
 * @param {EscapeCallback} esc
 * @param {Function} [lineMapper] maps a generated-function line to a template line
 */
class EjsError extends Error {
  constructor(err, str, flnm, lineno, esc, lineMapper) {
    let original = err instanceof Error ? err : new Error(String(err));
    let filename = esc(flnm);
    let line = lineno;
    let col = null;
    let loc = stackLocation(original.stack, flnm);
    if (loc && lineMapper) {
      let mapped = lineMapper(loc.line);
      if (mapped) {
        line = mapped;
        col = loc.col;
      }
    }

    let lines = str.split('\n');
    let start = Math.max(line - 30, 0);
    let end = Math.min(lines.length, line + 3);
    let context = lines.slice(start, end).map(function (src, i) {
      let curr = i + start + 1;
      return (curr == line ? ' >> ' : '    ') + curr + '| ' + src;
    }).join('\n');

    let message = (filename || 'ejs') + ':' + line + '\n' + context + '\n\n' +
      (original.name && original.name !== 'Error' ? original.name + ': ' : '') + original.message;
    super(message);
    Object.setPrototypeOf(this, EjsError.prototype);

    this.name = 'EjsError';
    this.message = message;
    this.path = filename;
    this.filename = filename;
    this.line = line;
    this.col = col;
    this.context = context;
    this.status = original.status || 500;
    this.originalError = original;
    this.cause = original;
    // Keep the original stack: it names the original error type and points into
    // the code that actually failed. (The template location is in `message`.)
    if (original.stack) {
      this.stack = original.stack;
    }
  }
}
ejs.EjsError = EjsError;

/**
 * Re-throw the given `err` in context to the `str` of ejs, `filename`, and
 * `lineno`.
 *
 * @implements {RethrowCallback}
 * @memberof module:ejs-internal
 * @param {Error}  err      Error object
 * @param {String} str      EJS source
 * @param {String} flnm     file name of the EJS file
 * @param {Number} lineno   line number of the error
 * @param {EscapeCallback} esc
 * @param {Function} [lineMapper]
 * @static
 */

function rethrow(err, str, flnm, lineno, esc, lineMapper) {
  // Already located (e.g. thrown from a nested include), or an API error whose
  // status the caller needs: rethrow untouched.
  if (err instanceof EjsError || isPassthroughError(err)) {
    throw err;
  }
  throw new EjsError(err, str, flnm, lineno, esc, lineMapper);
}

function stripSemi(str){
  return str.replace(/;(\s*$)/, '$1');
}

/**
 * Compile the given `str` of ejs into a template function.
 *
 * @param {String}  template EJS template
 *
 * @param {Options} [opts] compilation options
 *
 * @return {TemplateFunction}
 * Note that the return type of the function depends on the value of `opts.async`.
 * @public
 */

ejs.compile = function compile(template, opts) {
  let templ;

  // v1 compat
  // 'scope' is 'context'
  // FIXME: Remove this in a future version
  if (opts && opts.scope) {
    console.warn('`scope` option is deprecated and will be removed in future EJS');
    if (!opts.context) {
      opts.context = opts.scope;
    }
    delete opts.scope;
  }
  templ = new Template(template, opts);
  return templ.compile();
};

/**
 * Render the given `template` of ejs.
 *
 * If you would like to include options but not data, you need to explicitly
 * call this function with `data` being an empty object or `null`.
 *
 * @param {String}   template EJS template
 * @param {Object}  [data={}] template data
 * @param {Options} [opts={}] compilation and rendering options
 * @return {(String|Promise<String>)}
 * Return value type depends on `opts.async`.
 * @public
 */

ejs.render = function (template, d, o) {
  let data = d || utils.createNullProtoObjWherePossible();
  let opts = o || utils.createNullProtoObjWherePossible();

  return handleCache(opts, template)(data);
};

/**
 * Render an EJS file at the given `path` and callback `cb(err, str)`.
 *
 * If you would like to include options but not data, you need to explicitly
 * call this function with `data` being an empty object or `null`.
 *
 * @param {String}             path     path to the EJS file
 * @param {Object}            [data={}] template data
 * @param {Options}           [opts={}] compilation and rendering options
 * @param {RenderFileCallback} cb callback
 * @public
 */

ejs.renderFile = function () {
  let args = Array.prototype.slice.call(arguments);
  let filename = args.shift();
  let opts = {filename: filename};
  let data;

  // Do we have data/opts?
  if (args.length) {
    // Should always have data obj; null/undefined means no data
    data = args.shift();
    if (data == null) {
      data = utils.createNullProtoObjWherePossible();
    }
    // Normal passed opts (data obj + opts obj)
    if (args.length) {
      // Use shallowCopy so we don't pollute passed in opts obj with new vals
      utils.shallowCopy(opts, args.pop());
    }
    // Express passes app settings in with the data
    else if (utils.hasOwn(data, 'settings') && data.settings) {
      if (data.settings.views) {
        opts.views = data.settings.views;
      }
      if (data.settings['view cache']) {
        opts.cache = true;
      }
    }
    opts.filename = filename;
  }
  else {
    data = utils.createNullProtoObjWherePossible();
  }

  // pocketbase-ejs: JSVM is synchronous, so render immediately (no callback/Promise)
  return handleCache(opts)(data);
};

/**
 * Clear intermediate JavaScript cache. Calls {@link Cache#reset}.
 * @public
 */

/**
 * EJS template class
 * @public
 */
ejs.Template = Template;

ejs.clearCache = function () {
  ejs.cache.reset();
};

function Template(text, optsParam) {
  let opts = utils.hasOwnOnlyObject(optsParam);
  let options = utils.createNullProtoObjWherePossible();
  this.templateText = text;
  /** @type {string | null} */
  this.mode = null;
  this.truncate = false;
  this.currentLine = 1;
  this.source = '';
  // pocketbase-ejs: template line for each line of this.source (see scanLine)
  this.sourceLineMap = [];
  // pocketbase-ejs: custom include hook and code prepended to every compiled template
  options.includeFile = opts.includeFile || ejs.includeFile;
  options.prepend = opts.prepend || '';
  options.escapeFunction = opts.escape || opts.escapeFunction || utils.escapeXML;
  options.compileDebug = opts.compileDebug !== false;
  options.debug = !!opts.debug;
  options.filename = opts.filename;
  options.openDelimiter = opts.openDelimiter || ejs.openDelimiter || _DEFAULT_OPEN_DELIMITER;
  options.closeDelimiter = opts.closeDelimiter || ejs.closeDelimiter || _DEFAULT_CLOSE_DELIMITER;
  options.delimiter = opts.delimiter || ejs.delimiter || _DEFAULT_DELIMITER;
  options.strict = opts.strict || false;
  options.context = opts.context;
  options.cache = opts.cache || false;
  options.rmWhitespace = opts.rmWhitespace;
  options.root = opts.root;
  options.includer = opts.includer;
  options.outputFunctionName = opts.outputFunctionName;
  options.localsName = opts.localsName || ejs.localsName || _DEFAULT_LOCALS_NAME;
  options.views = opts.views;
  options.async = opts.async;
  options.destructuredLocals = opts.destructuredLocals;
  options.legacyInclude = typeof opts.legacyInclude != 'undefined' ? !!opts.legacyInclude : true;
  // Opt-in: keep locals' prototype chain visible inside `with`. Vulnerable to
  // prototype-pollution gadgets (Object.prototype.escapeFn, include, etc.) —
  // default is to strip the prototype chain via a shallow null-proto copy.
  options.unsafePrototypeLocals = !!opts.unsafePrototypeLocals;

  if (options.strict) {
    options._with = false;
  }
  else {
    options._with = typeof opts._with != 'undefined' ? opts._with : true;
  }

  this.opts = options;

  this.regex = this.createRegex();
  this.tags = buildTags(options);
}

// The tag strings for a set of delimiters, built once per template rather
// than on every scanned token.
function buildTags(opts) {
  let o = opts.openDelimiter;
  let d = opts.delimiter;
  let c = opts.closeDelimiter;
  return {
    eval: o + d,
    evalSlurp: o + d + '_',
    escaped: o + d + '=',
    raw: o + d + '-',
    comment: o + d + '#',
    literalOpen: o + d + d,
    close: d + c,
    closeTrim: '-' + d + c,
    closeSlurp: '_' + d + c,
    literalClose: d + d + c
  };
}

// Count '\n' without allocating an array per token (as split() would).
function countNewlines(str) {
  let count = 0;
  for (let i = str.indexOf('\n'); i !== -1; i = str.indexOf('\n', i + 1)) {
    count++;
  }
  return count;
}

Template.modes = {
  EVAL: 'eval',
  ESCAPED: 'escaped',
  RAW: 'raw',
  COMMENT: 'comment',
  LITERAL: 'literal'
};

Template.prototype = {
  createRegex: function () {
    let str = _REGEX_STRING;
    let delim = utils.escapeRegExpChars(this.opts.delimiter);
    let open = utils.escapeRegExpChars(this.opts.openDelimiter);
    let close = utils.escapeRegExpChars(this.opts.closeDelimiter);
    str = str.replace(/%/g, delim)
      .replace(/</g, open)
      .replace(/>/g, close);
    return new RegExp(str);
  },

  compile: function () {
    /** @type {string} */
    let src;
    let fn;
    let opts = this.opts;
    let prepended = opts.prepend ? opts.prepend + '\n' : '';
    let appended = '';
    /** @type {EscapeCallback} */
    let escapeFn = opts.escapeFunction;
    /** @type {FunctionConstructor} */
    let ctor;
    /** @type {string} */
    let sanitizedFilename = opts.filename ? JSON.stringify(opts.filename) : 'undefined';

    if (!this.source) {
      this.generateSource();
      prepended +=
        `  ${DECLARATION_KEYWORD} __output = "";\n` +
        '  function __append(s) { if (s !== undefined && s !== null) __output += s }\n';
      if (opts.outputFunctionName) {
        if (!_JS_IDENTIFIER.test(opts.outputFunctionName)) {
          throw new Error('outputFunctionName is not a valid JS identifier.');
        }
        prepended += `  ${DECLARATION_KEYWORD} ` + opts.outputFunctionName + ' = __append;' + '\n';
      }
      if (opts.localsName && !_JS_IDENTIFIER.test(opts.localsName)) {
        throw new Error('localsName is not a valid JS identifier.');
      }
      if (opts.destructuredLocals && opts.destructuredLocals.length) {
        let destructuring = `  ${DECLARATION_KEYWORD} __locals = (` + opts.localsName + ' || {}),\n';
        for (let i = 0; i < opts.destructuredLocals.length; i++) {
          let name = opts.destructuredLocals[i];
          if (!_JS_IDENTIFIER.test(name)) {
            throw new Error('destructuredLocals[' + i + '] is not a valid JS identifier.');
          }
          if (i > 0) {
            destructuring += ',\n  ';
          }
          destructuring += name + ' = __locals.' + name;
        }
        prepended += destructuring + ';\n';
      }
      if (opts._with !== false) {
        prepended +=  '  with (' + opts.localsName + ' || {}) {' + '\n';
        appended += '  }' + '\n';
      }
      appended += '  return __output;' + '\n';
      this.source = prepended + this.source + appended;
    }

    if (opts.compileDebug) {
      src = `${DECLARATION_KEYWORD} __line = 1` + '\n'
        + '  , __lines = ' + JSON.stringify(this.templateText) + '\n'
        + '  , __filename = ' + sanitizedFilename + ';' + '\n'
        + 'try {' + '\n'
        + this.source
        + '} catch (e) {' + '\n'
        + '  rethrow(e, __lines, __filename, __line, escapeFn, __lineMapper);' + '\n'
        + '}' + '\n';
    }
    else {
      src = this.source;
    }

    if (opts.strict) {
      src = '"use strict";\n' + src;
    }
    if (opts.debug) {
      console.log(src);
    }
    if (opts.compileDebug && opts.filename) {
      src = src + '\n'
        + '//# sourceURL=' + sanitizedFilename + '\n';
    }

    try {
      if (opts.async) {
        // Have to use generated function for this, since in envs without support,
        // it breaks in parsing
        try {
          ctor = (new Function('return (async function(){}).constructor;'))();
        }
        catch(e) {
          if (e instanceof SyntaxError) {
            throw new Error('This environment does not support async/await');
          }
          else {
            throw e;
          }
        }
      }
      else {
        ctor = Function;
      }
      fn = new ctor(opts.localsName + ', escapeFn, include, rethrow, __lineMapper', src);
    }
    catch(e) {
      // istanbul ignore else
      if (e instanceof SyntaxError) {
        if (opts.filename) {
          e.message += ' in ' + opts.filename;
        }
        e.message += ' while compiling ejs\n\n';
        e.message += 'If the above error is not helpful, you may want to try EJS-Lint:\n';
        e.message += 'https://github.com/RyanZim/EJS-Lint';
        if (!opts.async) {
          e.message += '\n';
          e.message += 'Or, if you meant to create an async function, pass `async: true` as an option.';
        }
      }
      throw e;
    }

    // Return a callable function which will execute the function
    // created by the source-code, with the passed data as locals
    // Adds a local `include` function which allows full recursive include
    // pocketbase-ejs: maps a line of the generated function (from an error stack)
    // back to the template line, so errors in multi-line <% %> blocks point at
    // the right line instead of the line the block starts on.
    // The compileDebug header (`let __line`, `__lines`, `__filename`, `try {`) is 4 lines.
    let bodyStart = (opts.strict ? 1 : 0) + 4 + countNewlines(prepended);
    let sourceLineMap = this.sourceLineMap;
    let lineMapper = function (fnLine) {
      let idx = fnLine - functionWrapperLines() - bodyStart - 1;
      return idx >= 0 && idx < sourceLineMap.length ? sourceLineMap[idx] : null;
    };
    let returnedFn = function anonymous(data) {
      let include = function (path, includeData) {
        let d = utils.shallowCopy(utils.createNullProtoObjWherePossible(), data);
        if (includeData) {
          d = utils.shallowCopy(d, includeData);
        }
        return opts.includeFile(path, opts)(d);
      };
      let locals;
      if (opts.unsafePrototypeLocals) {
        locals = data || utils.createNullProtoObjWherePossible();
      }
      else {
        locals = utils.shallowCopy(utils.createNullProtoObjWherePossible(), data);
      }
      return fn.apply(opts.context,
        [locals, escapeFn, include, rethrow, lineMapper]);
    };
    if (opts.filename && typeof Object.defineProperty === 'function') {
      let filename = opts.filename;
      let basename = path.basename(filename, path.extname(filename));
      try {
        Object.defineProperty(returnedFn, 'name', {
          value: basename,
          writable: false,
          enumerable: false,
          configurable: true
        });
      } catch (e) {/* ignore */}
    }
    return returnedFn;
  },

  generateSource: function () {
    let opts = this.opts;

    if (opts.rmWhitespace) {
      // Have to use two separate replace here as `^` and `$` operators don't
      // work well with `\r` and empty lines don't work well with the `m` flag.
      this.templateText =
        this.templateText.replace(/[\r\n]+/g, '\n').replace(/^\s+|\s+$/gm, '');
    }

    let self = this;
    let tags = this.tags;

    // Slurp spaces and tabs before opening whitespace slurp tag and after closing whitespace slurp tag
    let openWhitespaceSlurpTag = utils.escapeRegExpChars(tags.evalSlurp);
    let closeWhitespaceSlurpTag = utils.escapeRegExpChars(tags.closeSlurp);
    let openWhitespaceSlurpReplacement = tags.evalSlurp;
    let closeWhitespaceSlurpReplacement = tags.closeSlurp;
    this.templateText =
      this.templateText.replace(new RegExp('[ \\t]*' + openWhitespaceSlurpTag, 'gm'), openWhitespaceSlurpReplacement)
        .replace(new RegExp(closeWhitespaceSlurpTag + '[ \\t]*', 'gm'), closeWhitespaceSlurpReplacement);

    let matches = this.parseTemplateText();

    if (matches && matches.length) {
      matches.forEach(function (line, index) {
        let closing;
        // If this is an opening tag, check for closing tags
        // FIXME: May end up with some false positives here
        // Better to store modes as k/v with openDelimiter + delimiter as key
        // Then this can simply check against the map
        if ( line.indexOf(tags.eval) === 0        // If it is a tag
          && line.indexOf(tags.literalOpen) !== 0) { // and is not escaped
          closing = matches[index + 2];
          if (!(closing == tags.close || closing == tags.closeTrim || closing == tags.closeSlurp)) {
            throw new Error('Could not find matching close tag for "' + line + '".');
          }
        }
        self.scanLine(line);
      });
    }

  },

  parseTemplateText: function () {
    let str = this.templateText;
    let pat = this.regex;
    let result = pat.exec(str);
    let arr = [];
    let firstPos;

    while (result) {
      firstPos = result.index;

      if (firstPos !== 0) {
        arr.push(str.substring(0, firstPos));
        str = str.slice(firstPos);
      }

      arr.push(result[0]);
      str = str.slice(result[0].length);
      result = pat.exec(str);
    }

    if (str) {
      arr.push(str);
    }

    return arr;
  },

  _addOutput: function (line) {
    if (this.truncate) {
      // Only replace single leading linebreak in the line after
      // -%> tag -- this is the single, trailing linebreak
      // after the tag that the truncation mode replaces
      // Handle Win / Unix / old Mac linebreaks -- do the \r\n
      // combo first in the regex-or
      line = line.replace(/^(?:\r\n|\r|\n)/, '');
      this.truncate = false;
    }
    if (!line) {
      return line;
    }

    // Preserve literal slashes
    line = line.replace(/\\/g, '\\\\');

    // Convert linebreaks
    line = line.replace(/\n/g, '\\n');
    line = line.replace(/\r/g, '\\r');

    // Escape double-quotes
    // - this will be the delimiter during execution
    line = line.replace(/"/g, '\\"');
    this.source += '    ; __append("' + line + '")' + '\n';
  },

  scanLine: function (line) {
    let self = this;
    let tags = this.tags;
    let newLineCount = countNewlines(line);
    let sourceStart = this.source.length;
    let startLine = this.currentLine;

    switch (line) {
    case tags.eval:
    case tags.evalSlurp:
      this.mode = Template.modes.EVAL;
      break;
    case tags.escaped:
      this.mode = Template.modes.ESCAPED;
      break;
    case tags.raw:
      this.mode = Template.modes.RAW;
      break;
    case tags.comment:
      this.mode = Template.modes.COMMENT;
      break;
    case tags.literalOpen:
      this.mode = Template.modes.LITERAL;
      // JSON.stringify quotes delimiter chars like " and \ safely
      this.source += '    ; __append(' + JSON.stringify(tags.eval) + ')' + '\n';
      break;
    case tags.literalClose:
      this.mode = Template.modes.LITERAL;
      this.source += '    ; __append(' + JSON.stringify(tags.close) + ')' + '\n';
      break;
    case tags.close:
    case tags.closeTrim:
    case tags.closeSlurp:
      if (this.mode == Template.modes.LITERAL) {
        this._addOutput(line);
      }

      this.mode = null;
      this.truncate = line.indexOf('-') === 0 || line.indexOf('_') === 0;
      break;
    default:
      // In script mode, depends on type of tag
      if (this.mode) {
        // If '//' is found without a line break, add a line break.
        switch (this.mode) {
        case Template.modes.EVAL:
        case Template.modes.ESCAPED:
        case Template.modes.RAW:
          if (line.lastIndexOf('//') > line.lastIndexOf('\n')) {
            line += '\n';
          }
        }
        switch (this.mode) {
        // Just executing code
        case Template.modes.EVAL:
          this.source += '    ; ' + line + '\n';
          break;
          // Exec, esc, and output
        case Template.modes.ESCAPED:
          this.source += '    ; __append(escapeFn(' + stripSemi(line) + '))' + '\n';
          break;
          // Exec and output
        case Template.modes.RAW:
          this.source += '    ; __append(' + stripSemi(line) + ')' + '\n';
          break;
        case Template.modes.COMMENT:
          // Do nothing
          break;
          // Literal <%% mode, append as raw output
        case Template.modes.LITERAL:
          this._addOutput(line);
          break;
        }
      }
      // In string mode, just add the output
      else {
        this._addOutput(line);
      }
    }

    // pocketbase-ejs: code tokens keep the template's own newlines, and every other
    // token emits a single line, so line i of this token's output is startLine + i.
    let emitted = countNewlines(this.source.slice(sourceStart));
    for (let i = 0; i < emitted; i++) {
      this.sourceLineMap.push(startLine + i);
    }

    if (self.opts.compileDebug && newLineCount) {
      this.currentLine += newLineCount;
      this.source += '    ; __line = ' + this.currentLine + '\n';
      this.sourceLineMap.push(this.currentLine);
    }
  }
};

/**
 * Escape characters reserved in XML.
 *
 * This is simply an export of {@link module:utils.escapeXML}.
 *
 * If `markup` is `undefined` or `null`, the empty string is returned.
 *
 * @param {String} markup Input string
 * @return {String} Escaped string
 * @public
 * @func
 * */
ejs.escapeXML = utils.escapeXML;

/**
 * Express.js support.
 *
 * This is an alias for {@link module:ejs.renderFile}, in order to support
 * Express.js out-of-the-box.
 *
 * @func
 */

ejs.__express = ejs.renderFile;

/* istanbul ignore if */
if (typeof window != 'undefined') {
  window.ejs = ejs;
}

export default ejs;
