export type JsonSchemaLike = {
    type: 'string';
    description?: string;
    enum?: string[];
} | {
    type: 'number';
    description?: string;
} | {
    type: 'integer';
    description?: string;
} | {
    type: 'boolean';
    description?: string;
} | {
    type: 'array';
    description?: string;
    items: JsonSchemaLike;
} | {
    type: 'object';
    description?: string;
    properties?: Record<string, JsonSchemaLike>;
    required?: string[];
    additionalProperties?: boolean;
};
export type JsonObjectSchema = Extract<JsonSchemaLike, {
    type: 'object';
}>;
export interface ToolExecuteContext {
    cwd?: string;
    signal?: AbortSignal;
}
export interface AgentToolDefinition<TInput extends Record<string, unknown> = Record<string, unknown>, TOutput = unknown, TContext extends ToolExecuteContext = ToolExecuteContext> {
    name: string;
    description: string;
    inputSchema: JsonObjectSchema;
    execute(input: TInput, context: TContext): Promise<TOutput>;
}
