import { forgejo } from "./forgejo";
import { gitlab } from "./gitlab";
import type { Provider, ProviderKind } from "./types";

export * from "./types";

const factories: Record<ProviderKind, (host: string) => Provider> = { gitlab, forgejo };

export const createProvider = (kind: ProviderKind, host: string) => factories[kind](host);
