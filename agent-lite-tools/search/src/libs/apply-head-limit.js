"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyHeadLimit = applyHeadLimit;
const DEFAULT_HEAD_LIMIT = 250;
function applyHeadLimit(items, limit, offset = 0) {
    if (limit === 0) {
        return { items: items.slice(offset), appliedLimit: undefined };
    }
    const effectiveLimit = limit ?? DEFAULT_HEAD_LIMIT;
    const sliced = items.slice(offset, offset + effectiveLimit);
    const wasTruncated = items.length - offset > effectiveLimit;
    return {
        items: sliced,
        appliedLimit: wasTruncated ? effectiveLimit : undefined,
    };
}
