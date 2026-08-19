'use strict';
// Shared HTTP helpers. Kept independent from util/audit so importing this
// doesn't pull in a database connection.

/** Wrap async route handlers so thrown errors reach the error middleware. */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
