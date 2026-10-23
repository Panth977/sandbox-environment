import type { Endpoint } from "../bridge.js";
import type { BootPayload, ConsoleEntry, RuntimeErrorEntry, Theme } from "../protocol.js";
interface HostInternal {
    $sbx: {
        console(e: ConsoleEntry): void;
        error(e: RuntimeErrorEntry): void;
        size(height: number): void;
        ready(): void;
        open(url: string): void;
    };
}
export interface RuntimeState {
    endpoint: Endpoint<HostInternal & Record<string, unknown>>;
    boot: BootPayload;
    exposed: Record<string, unknown>;
    theme: Theme;
    env: Record<string, unknown>;
    themeListeners: Set<(t: Theme) => void>;
    envListeners: Set<(e: Record<string, unknown>) => void>;
}
/** The runtime's globals (typed here, not declared globally: a library must not change global types). */
export interface RuntimeGlobals {
    __sbxBoot?: {
        port: MessagePort;
        boot: BootPayload;
        urls: Record<string, string>;
    };
    __sbx?: RuntimeState;
}
export {};
