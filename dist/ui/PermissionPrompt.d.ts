import React from 'react';
import { ToolCall, ApprovalMode } from '../types/index.js';
interface PermissionPromptProps {
    toolCall: ToolCall;
}
export declare function needsApproval(toolCall: ToolCall, mode: ApprovalMode): boolean;
export declare function needsPermission(toolCall: ToolCall): boolean;
export declare function PermissionPrompt({ toolCall }: PermissionPromptProps): React.ReactElement;
export {};
//# sourceMappingURL=PermissionPrompt.d.ts.map