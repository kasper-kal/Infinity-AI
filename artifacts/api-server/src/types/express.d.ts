/**
 * Express request augmentation for pino-http logger.
 * pino-http augments http.IncomingMessage with `.log` and `.id` properties.
 * This declaration extends Express Request to include those properties.
 */
import "express";
import pino from "pino";

declare global {
  namespace Express {
    interface Request {
      log: pino.Logger;
      id: pinoHttp.ReqId;
      allLogs: pino.Logger[];
    }
  }
}

// Import pino-http types for ReqId
import pinoHttp from "pino-http";