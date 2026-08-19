'use strict';
// Small, focused HTTP-error hierarchy. Route handlers `throw` these; the
// central errorHandler middleware formats them into the JSON response envelope.
//
// The response shape stays close to what the frontend already reads:
//   { error: 'code_snake_case', message: 'human readable', ...extras }
// So old consumers that only look at `error` keep working; new ones can pick
// up the message and extras (e.g. field list on a validation error).

class HttpError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code   short machine-readable code (snake_case)
   * @param {string} [message] human message; defaults to the code
   * @param {object} [extras]  extra fields merged into the response
   */
  constructor(status, code, message, extras = {}) {
    super(message || code);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
    this.extras = extras;
    // Keep .stack minimal in tests — no Error subclass fluff.
    if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
  }
  toJSON() {
    return { error: this.code, message: this.message, ...this.extras };
  }
}

class BadRequestError extends HttpError {
  constructor(message, extras) { super(400, 'validation_failed', message, extras); }
}
class UnauthorizedError extends HttpError {
  constructor(code = 'unauthorized', message) { super(401, code, message); }
}
class ForbiddenError extends HttpError {
  constructor(code = 'forbidden', message, extras) { super(403, code, message, extras); }
}
class NotFoundError extends HttpError {
  constructor(code = 'not_found', message) { super(404, code, message); }
}
class ConflictError extends HttpError {
  constructor(code = 'conflict', message) { super(409, code, message); }
}
class TooManyRequestsError extends HttpError {
  constructor(message, extras) { super(429, 'rate_limited', message, extras); }
}

module.exports = {
  HttpError,
  BadRequestError, UnauthorizedError, ForbiddenError,
  NotFoundError, ConflictError, TooManyRequestsError,
};
