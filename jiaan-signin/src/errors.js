'use strict';
class AppError extends Error {
  constructor(message, status = 502, code) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    if (Number.isSafeInteger(code)) this.code = code;
  }
}
module.exports = { AppError };
