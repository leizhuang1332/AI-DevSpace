/**
 * Reserved for central error enum when schema grows beyond api.ts.
 * Currently ApiError / NotImplementedError / ApiErrorCode live in `./api.ts`.
 * This barrel is the future home for cross-cutting error utilities.
 */
export { ApiError, NotImplementedError, ApiErrorCode } from './api.js'
export type { ApiErrorT, NotImplementedErrorT } from './api.js'