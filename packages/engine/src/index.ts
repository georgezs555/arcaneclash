// Public API of the shared game engine.
// Importing this module registers the starter card set as a side effect.

export * from "./types";
export * from "./registry";
export * from "./mechanics";
export * from "./game";
export * from "./ai";
export * from "./redact";
export * from "./deck";
export { STARTER_CORE, starterDeckFor } from "./cards";
import "./cards";
