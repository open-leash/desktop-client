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
        readonly name: "Leash Project Protection";
        readonly description: "Stops AI before it deletes files, damages your database, or breaks your project.";
        readonly category: "protection";
        readonly iconText: "💥";
        readonly showcaseOrder: 1;
    };
    readonly "code-scanner": {
        readonly id: "openleash.code-scanner";
        readonly slug: "code-scanner";
        readonly name: "Leash Code Protection";
        readonly description: "Checks the code AI writes and warns you when it could make your app unsafe.";
        readonly category: "protection";
        readonly iconText: "☣️";
        readonly showcaseOrder: 2;
    };
    readonly "data-leakage-prevention": {
        readonly id: "openleash.dlp";
        readonly slug: "data-leakage-prevention";
        readonly name: "Leash Private Data Protection";
        readonly description: "Stops AI from accidentally sharing passwords, personal information, or private files.";
        readonly category: "protection";
        readonly iconText: "🤫";
        readonly showcaseOrder: 3;
    };
    readonly "sensitive-access": {
        readonly id: "openleash.sensitive-access";
        readonly slug: "sensitive-access";
        readonly name: "Leash Password Protection";
        readonly description: "Asks before AI opens password files, sign-in details, or other private access information.";
        readonly category: "protection";
        readonly iconText: "🔐";
        readonly showcaseOrder: 4;
    };
    readonly "skill-scanner": {
        readonly id: "openleash.skill-scanner";
        readonly slug: "skill-scanner";
        readonly name: "Leash Hidden Instructions Protection";
        readonly description: "Finds hidden instructions that try to make AI do something you did not ask it to do.";
        readonly category: "protection";
        readonly iconText: "🕵️";
        readonly showcaseOrder: 5;
    };
    readonly "mcp-scanner": {
        readonly id: "openleash.mcp-scanner";
        readonly slug: "mcp-scanner";
        readonly name: "Leash Connected Apps Protection";
        readonly description: "Shows which outside apps and tools AI can use and warns you when something changes.";
        readonly category: "protection";
        readonly iconText: "📡";
        readonly showcaseOrder: 6;
    };
    readonly "rules-enforcer": {
        readonly id: "openleash.rules-enforcer";
        readonly slug: "rules-enforcer";
        readonly name: "Leash Rules";
        readonly description: "Makes AI follow the project rules you choose and asks before it crosses one.";
        readonly category: "protection";
        readonly iconText: "📏";
        readonly showcaseOrder: 7;
    };
    readonly "token-saver": {
        readonly id: "openleash.prompt-compression";
        readonly slug: "token-saver";
        readonly name: "Leash AI Cost Saver";
        readonly description: "Cuts repeated text so your AI bill is lower without removing the important parts.";
        readonly category: "cost";
        readonly iconText: "✂️";
        readonly showcaseOrder: 8;
    };
};
export type LeashFeatureSlug = keyof typeof LEASH_FEATURE_PRESENTATIONS;
export declare function leashFeaturePresentation(value: string | undefined | null): {
    readonly id: "openleash.blast-radius";
    readonly slug: "blast-radius";
    readonly name: "Leash Project Protection";
    readonly description: "Stops AI before it deletes files, damages your database, or breaks your project.";
    readonly category: "protection";
    readonly iconText: "💥";
    readonly showcaseOrder: 1;
} | {
    readonly id: "openleash.code-scanner";
    readonly slug: "code-scanner";
    readonly name: "Leash Code Protection";
    readonly description: "Checks the code AI writes and warns you when it could make your app unsafe.";
    readonly category: "protection";
    readonly iconText: "☣️";
    readonly showcaseOrder: 2;
} | {
    readonly id: "openleash.dlp";
    readonly slug: "data-leakage-prevention";
    readonly name: "Leash Private Data Protection";
    readonly description: "Stops AI from accidentally sharing passwords, personal information, or private files.";
    readonly category: "protection";
    readonly iconText: "🤫";
    readonly showcaseOrder: 3;
} | {
    readonly id: "openleash.sensitive-access";
    readonly slug: "sensitive-access";
    readonly name: "Leash Password Protection";
    readonly description: "Asks before AI opens password files, sign-in details, or other private access information.";
    readonly category: "protection";
    readonly iconText: "🔐";
    readonly showcaseOrder: 4;
} | {
    readonly id: "openleash.skill-scanner";
    readonly slug: "skill-scanner";
    readonly name: "Leash Hidden Instructions Protection";
    readonly description: "Finds hidden instructions that try to make AI do something you did not ask it to do.";
    readonly category: "protection";
    readonly iconText: "🕵️";
    readonly showcaseOrder: 5;
} | {
    readonly id: "openleash.mcp-scanner";
    readonly slug: "mcp-scanner";
    readonly name: "Leash Connected Apps Protection";
    readonly description: "Shows which outside apps and tools AI can use and warns you when something changes.";
    readonly category: "protection";
    readonly iconText: "📡";
    readonly showcaseOrder: 6;
} | {
    readonly id: "openleash.rules-enforcer";
    readonly slug: "rules-enforcer";
    readonly name: "Leash Rules";
    readonly description: "Makes AI follow the project rules you choose and asks before it crosses one.";
    readonly category: "protection";
    readonly iconText: "📏";
    readonly showcaseOrder: 7;
} | {
    readonly id: "openleash.prompt-compression";
    readonly slug: "token-saver";
    readonly name: "Leash AI Cost Saver";
    readonly description: "Cuts repeated text so your AI bill is lower without removing the important parts.";
    readonly category: "cost";
    readonly iconText: "✂️";
    readonly showcaseOrder: 8;
};
export declare const LEASH_FEATURE_SHOWCASE: ({
    readonly id: "openleash.blast-radius";
    readonly slug: "blast-radius";
    readonly name: "Leash Project Protection";
    readonly description: "Stops AI before it deletes files, damages your database, or breaks your project.";
    readonly category: "protection";
    readonly iconText: "💥";
    readonly showcaseOrder: 1;
} | {
    readonly id: "openleash.code-scanner";
    readonly slug: "code-scanner";
    readonly name: "Leash Code Protection";
    readonly description: "Checks the code AI writes and warns you when it could make your app unsafe.";
    readonly category: "protection";
    readonly iconText: "☣️";
    readonly showcaseOrder: 2;
} | {
    readonly id: "openleash.dlp";
    readonly slug: "data-leakage-prevention";
    readonly name: "Leash Private Data Protection";
    readonly description: "Stops AI from accidentally sharing passwords, personal information, or private files.";
    readonly category: "protection";
    readonly iconText: "🤫";
    readonly showcaseOrder: 3;
} | {
    readonly id: "openleash.sensitive-access";
    readonly slug: "sensitive-access";
    readonly name: "Leash Password Protection";
    readonly description: "Asks before AI opens password files, sign-in details, or other private access information.";
    readonly category: "protection";
    readonly iconText: "🔐";
    readonly showcaseOrder: 4;
} | {
    readonly id: "openleash.skill-scanner";
    readonly slug: "skill-scanner";
    readonly name: "Leash Hidden Instructions Protection";
    readonly description: "Finds hidden instructions that try to make AI do something you did not ask it to do.";
    readonly category: "protection";
    readonly iconText: "🕵️";
    readonly showcaseOrder: 5;
} | {
    readonly id: "openleash.mcp-scanner";
    readonly slug: "mcp-scanner";
    readonly name: "Leash Connected Apps Protection";
    readonly description: "Shows which outside apps and tools AI can use and warns you when something changes.";
    readonly category: "protection";
    readonly iconText: "📡";
    readonly showcaseOrder: 6;
} | {
    readonly id: "openleash.rules-enforcer";
    readonly slug: "rules-enforcer";
    readonly name: "Leash Rules";
    readonly description: "Makes AI follow the project rules you choose and asks before it crosses one.";
    readonly category: "protection";
    readonly iconText: "📏";
    readonly showcaseOrder: 7;
} | {
    readonly id: "openleash.prompt-compression";
    readonly slug: "token-saver";
    readonly name: "Leash AI Cost Saver";
    readonly description: "Cuts repeated text so your AI bill is lower without removing the important parts.";
    readonly category: "cost";
    readonly iconText: "✂️";
    readonly showcaseOrder: 8;
})[];
