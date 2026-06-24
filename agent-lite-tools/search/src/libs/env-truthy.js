"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEnvTruthy = isEnvTruthy;
/** Treat empty string as unset so defaults apply (matches Claude glob env behavior). */
function isEnvTruthy(raw, defaultValue) {
    if (raw === undefined || raw === '') {
        return defaultValue;
    }
    const v = raw.trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(v)) {
        return false;
    }
    if (['1', 'true', 'yes', 'on'].includes(v)) {
        return true;
    }
    return defaultValue;
}
