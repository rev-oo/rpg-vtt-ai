// Field limits of the HTTP API (specs §10.1); forms show them as hints.

/** 3–32 letters, digits, `_`, `.` or `-`. */
export const USERNAME_PATTERN = /^[A-Za-z0-9_.-]{3,32}$/;
export const MAX_USERNAME_INPUT = 64;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;
export const MAX_DISPLAY_NAME = 64;
export const MAX_TABLE_NAME = 100;
export const MAX_TABLE_DESCRIPTION = 2000;
export const MAX_SYSTEM_ID = 100;
export const MAX_ENTITY_NAME = 100;
export const MAX_ENTITY_TYPE = 64;
export const MAX_IMAGE_URL = 2048;
export const MAX_SEARCH = 100;
