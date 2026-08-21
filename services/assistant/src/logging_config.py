"""Structured JSON logging configuration for the api service."""

import json
import logging
import time
from typing import Any


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_data: dict[str, Any] = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if record.exc_info:
            log_data["exc"] = self.formatException(record.exc_info)
        # Include any extra fields set via logger.info(..., extra={...})
        for key, val in record.__dict__.items():
            if key not in (
                "msg",
                "args",
                "levelname",
                "levelno",
                "name",
                "pathname",
                "filename",
                "module",
                "exc_info",
                "exc_text",
                "stack_info",
                "lineno",
                "funcName",
                "created",
                "msecs",
                "relativeCreated",
                "thread",
                "threadName",
                "processName",
                "process",
                "message",
                "taskName",
            ):
                log_data[key] = val
        return json.dumps(log_data)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    logging.root.setLevel(getattr(logging, level.upper(), logging.INFO))
    logging.root.handlers = [handler]
