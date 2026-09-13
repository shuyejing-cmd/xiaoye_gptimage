export class AppError extends Error {
  constructor({ code, message, httpStatus = 500, retryable = false, cause }) {
    super(message, cause ? { cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.retryable = retryable;
  }
}

export function toSafeErrorMessage(error) {
  return error instanceof AppError ? error.message : "服务暂时不可用，请稍后重试。";
}