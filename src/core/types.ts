export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type Segment = string | number;
export type Path = Segment[];
export type Kind = "object" | "array" | "string" | "number" | "boolean" | "null";
