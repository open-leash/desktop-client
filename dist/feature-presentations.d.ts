export type LeashFeaturePresentation = {
    id: string;
    slug: string;
    name: string;
    description: string;
    category: "protection" | "cost";
    iconText: string;
    showcaseOrder: number;
};
export declare const LEASH_FEATURE_PRESENTATIONS: {
    readonly "blast-radius": {
        readonly id: "openleash.blast-radius";
        readonly slug: "blast-radius";
        readonly name: "Destruction Protection";
        readonly description: "Stops agents before they delete files, damage databases, or break important systems.";
        readonly category: "protection";
        readonly iconText: "💥";
        readonly showcaseOrder: 1;
    };
    readonly "code-scanner": {
        readonly id: "openleash.code-scanner";
        readonly slug: "code-scanner";
        readonly name: "Code Scanner";
        readonly description: "Reviews AI-generated code for security weaknesses before they become a problem.";
        readonly category: "protection";
        readonly iconText: "☣️";
        readonly showcaseOrder: 2;
    };
    readonly "data-leakage-prevention": {
        readonly id: "openleash.dlp";
        readonly slug: "data-leakage-prevention";
        readonly name: "Private Data Protection";
        readonly description: "Keeps passwords, personal information, and other sensitive data from being shared by mistake.";
        readonly category: "protection";
        readonly iconText: "🤫";
        readonly showcaseOrder: 3;
    };
    readonly "sensitive-access": {
        readonly id: "openleash.sensitive-access";
        readonly slug: "sensitive-access";
        readonly name: "Secret Access Protection";
        readonly description: "Warns you when an agent tries to open passwords, private keys, or other secret files.";
        readonly category: "protection";
        readonly iconText: "🔐";
        readonly showcaseOrder: 4;
    };
    readonly "skill-scanner": {
        readonly id: "openleash.skill-scanner";
        readonly slug: "skill-scanner";
        readonly name: "Instruction Scanning";
        readonly description: "Checks agent instructions for hidden or suspicious behavior before it can spread.";
        readonly category: "protection";
        readonly iconText: "🕵️";
        readonly showcaseOrder: 5;
    };
    readonly "mcp-scanner": {
        readonly id: "openleash.mcp-scanner";
        readonly slug: "mcp-scanner";
        readonly name: "Tool Scanner";
        readonly description: "Scans the outside tools and services your agents can use and shows what they do.";
        readonly category: "protection";
        readonly iconText: "📡";
        readonly showcaseOrder: 6;
    };
    readonly "rules-enforcer": {
        readonly id: "openleash.rules-enforcer";
        readonly slug: "rules-enforcer";
        readonly name: "Your Rules";
        readonly description: "Makes agents follow the boundaries you choose and asks before they cross one.";
        readonly category: "protection";
        readonly iconText: "📏";
        readonly showcaseOrder: 7;
    };
    readonly "token-saver": {
        readonly id: "openleash.prompt-compression";
        readonly slug: "token-saver";
        readonly name: "Token Saver";
        readonly description: "Reduces repeated context so agents use fewer paid AI tokens without losing important details.";
        readonly category: "cost";
        readonly iconText: "✂️";
        readonly showcaseOrder: 8;
    };
};
export type LeashFeatureSlug = keyof typeof LEASH_FEATURE_PRESENTATIONS;
export declare function leashFeaturePresentation(value: string | undefined | null): {
    readonly id: "openleash.blast-radius";
    readonly slug: "blast-radius";
    readonly name: "Destruction Protection";
    readonly description: "Stops agents before they delete files, damage databases, or break important systems.";
    readonly category: "protection";
    readonly iconText: "💥";
    readonly showcaseOrder: 1;
} | {
    readonly id: "openleash.code-scanner";
    readonly slug: "code-scanner";
    readonly name: "Code Scanner";
    readonly description: "Reviews AI-generated code for security weaknesses before they become a problem.";
    readonly category: "protection";
    readonly iconText: "☣️";
    readonly showcaseOrder: 2;
} | {
    readonly id: "openleash.dlp";
    readonly slug: "data-leakage-prevention";
    readonly name: "Private Data Protection";
    readonly description: "Keeps passwords, personal information, and other sensitive data from being shared by mistake.";
    readonly category: "protection";
    readonly iconText: "🤫";
    readonly showcaseOrder: 3;
} | {
    readonly id: "openleash.sensitive-access";
    readonly slug: "sensitive-access";
    readonly name: "Secret Access Protection";
    readonly description: "Warns you when an agent tries to open passwords, private keys, or other secret files.";
    readonly category: "protection";
    readonly iconText: "🔐";
    readonly showcaseOrder: 4;
} | {
    readonly id: "openleash.skill-scanner";
    readonly slug: "skill-scanner";
    readonly name: "Instruction Scanning";
    readonly description: "Checks agent instructions for hidden or suspicious behavior before it can spread.";
    readonly category: "protection";
    readonly iconText: "🕵️";
    readonly showcaseOrder: 5;
} | {
    readonly id: "openleash.mcp-scanner";
    readonly slug: "mcp-scanner";
    readonly name: "Tool Scanner";
    readonly description: "Scans the outside tools and services your agents can use and shows what they do.";
    readonly category: "protection";
    readonly iconText: "📡";
    readonly showcaseOrder: 6;
} | {
    readonly id: "openleash.rules-enforcer";
    readonly slug: "rules-enforcer";
    readonly name: "Your Rules";
    readonly description: "Makes agents follow the boundaries you choose and asks before they cross one.";
    readonly category: "protection";
    readonly iconText: "📏";
    readonly showcaseOrder: 7;
} | {
    readonly id: "openleash.prompt-compression";
    readonly slug: "token-saver";
    readonly name: "Token Saver";
    readonly description: "Reduces repeated context so agents use fewer paid AI tokens without losing important details.";
    readonly category: "cost";
    readonly iconText: "✂️";
    readonly showcaseOrder: 8;
};
export declare const LEASH_FEATURE_SHOWCASE: ({
    readonly id: "openleash.blast-radius";
    readonly slug: "blast-radius";
    readonly name: "Destruction Protection";
    readonly description: "Stops agents before they delete files, damage databases, or break important systems.";
    readonly category: "protection";
    readonly iconText: "💥";
    readonly showcaseOrder: 1;
} | {
    readonly id: "openleash.code-scanner";
    readonly slug: "code-scanner";
    readonly name: "Code Scanner";
    readonly description: "Reviews AI-generated code for security weaknesses before they become a problem.";
    readonly category: "protection";
    readonly iconText: "☣️";
    readonly showcaseOrder: 2;
} | {
    readonly id: "openleash.dlp";
    readonly slug: "data-leakage-prevention";
    readonly name: "Private Data Protection";
    readonly description: "Keeps passwords, personal information, and other sensitive data from being shared by mistake.";
    readonly category: "protection";
    readonly iconText: "🤫";
    readonly showcaseOrder: 3;
} | {
    readonly id: "openleash.sensitive-access";
    readonly slug: "sensitive-access";
    readonly name: "Secret Access Protection";
    readonly description: "Warns you when an agent tries to open passwords, private keys, or other secret files.";
    readonly category: "protection";
    readonly iconText: "🔐";
    readonly showcaseOrder: 4;
} | {
    readonly id: "openleash.skill-scanner";
    readonly slug: "skill-scanner";
    readonly name: "Instruction Scanning";
    readonly description: "Checks agent instructions for hidden or suspicious behavior before it can spread.";
    readonly category: "protection";
    readonly iconText: "🕵️";
    readonly showcaseOrder: 5;
} | {
    readonly id: "openleash.mcp-scanner";
    readonly slug: "mcp-scanner";
    readonly name: "Tool Scanner";
    readonly description: "Scans the outside tools and services your agents can use and shows what they do.";
    readonly category: "protection";
    readonly iconText: "📡";
    readonly showcaseOrder: 6;
} | {
    readonly id: "openleash.rules-enforcer";
    readonly slug: "rules-enforcer";
    readonly name: "Your Rules";
    readonly description: "Makes agents follow the boundaries you choose and asks before they cross one.";
    readonly category: "protection";
    readonly iconText: "📏";
    readonly showcaseOrder: 7;
} | {
    readonly id: "openleash.prompt-compression";
    readonly slug: "token-saver";
    readonly name: "Token Saver";
    readonly description: "Reduces repeated context so agents use fewer paid AI tokens without losing important details.";
    readonly category: "cost";
    readonly iconText: "✂️";
    readonly showcaseOrder: 8;
})[];
