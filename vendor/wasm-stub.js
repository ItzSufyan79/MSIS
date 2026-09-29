/**
 * Stub for satellite.js's WASM runtime.
 *
 * satellite.js v7 re-exports its Node-only wasm build (multi-thread
 * pthreads / worker_threads) from the main entry. Webpack's client compiler
 * chokes on the `node:worker_threads` / `node:module` imports inside it. The
 * browser never uses wasm — the pure-JS SGP4 math is what orbit tracking
 * needs — so this neutral module replaces the whole wasm subtree.
 */
export {};