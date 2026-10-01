import type { ResourceLoader } from "@earendil-works/pi-coding-agent";
type Identity = {
    childId: string;
    sessionId: string;
    runId: string;
};
/** Record even ungated bindings so an injected runtime cannot later be reused for a guarded child. */
export declare function noteChildRuntime(loader: ResourceLoader): void;
/** Trusted host scope, never supplied by workflow script arguments. Replacement revokes existing children. */
export declare class ChildApprovalScope {
    private root?;
    private required;
    private bridge?;
    private readonly children;
    constructor(root?: object | undefined);
    bind(root?: object): void;
    open(identity: Identity, signal?: AbortSignal): ChildApprovalAttachment | undefined;
}
export interface ChildApprovalAttachment {
    close(): void;
    attach(loader: ResourceLoader, sessionManager: object): {
        loader: ResourceLoader;
        verify(): void;
    };
}
export {};
