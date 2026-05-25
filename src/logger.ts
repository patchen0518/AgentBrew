// src/logger.ts
export class Logger {
  static info(message: string, ...args: any[]) {
    console.error(`[INFO] ${message}`, ...args);
  }

  static warn(message: string, ...args: any[]) {
    console.error(`[WARN] ${message}`, ...args);
  }

  static error(message: string, ...args: any[]) {
    console.error(`[ERROR] ${message}`, ...args);
  }

  static debug(message: string, ...args: any[]) {
    if (process.env.DEBUG) {
      console.error(`[DEBUG] ${message}`, ...args);
    }
  }
}
