export const LEASH_FEATURE_PRESENTATIONS = {
    "blast-radius": {
        "id": "openleash.blast-radius",
        "slug": "blast-radius",
        "name": "Destruction Protection",
        "description": "Stops agents before they delete files, damage databases, or break important systems.",
        "category": "protection",
        "iconText": "💥",
        "showcaseOrder": 1
    },
    "code-scanner": {
        "id": "openleash.code-scanner",
        "slug": "code-scanner",
        "name": "Code Scanner",
        "description": "Reviews AI-generated code for security weaknesses before they become a problem.",
        "category": "protection",
        "iconText": "☣️",
        "showcaseOrder": 2
    },
    "data-leakage-prevention": {
        "id": "openleash.dlp",
        "slug": "data-leakage-prevention",
        "name": "Private Data Protection",
        "description": "Keeps passwords, personal information, and other sensitive data from being shared by mistake.",
        "category": "protection",
        "iconText": "🤫",
        "showcaseOrder": 3
    },
    "sensitive-access": {
        "id": "openleash.sensitive-access",
        "slug": "sensitive-access",
        "name": "Secret Access Protection",
        "description": "Warns you when an agent tries to open passwords, private keys, or other secret files.",
        "category": "protection",
        "iconText": "🔐",
        "showcaseOrder": 4
    },
    "skill-scanner": {
        "id": "openleash.skill-scanner",
        "slug": "skill-scanner",
        "name": "Instruction Scanning",
        "description": "Checks agent instructions for hidden or suspicious behavior before it can spread.",
        "category": "protection",
        "iconText": "🕵️",
        "showcaseOrder": 5
    },
    "mcp-scanner": {
        "id": "openleash.mcp-scanner",
        "slug": "mcp-scanner",
        "name": "Tool Scanner",
        "description": "Scans the outside tools and services your agents can use and shows what they do.",
        "category": "protection",
        "iconText": "📡",
        "showcaseOrder": 6
    },
    "rules-enforcer": {
        "id": "openleash.rules-enforcer",
        "slug": "rules-enforcer",
        "name": "Your Rules",
        "description": "Makes agents follow the boundaries you choose and asks before they cross one.",
        "category": "protection",
        "iconText": "📏",
        "showcaseOrder": 7
    },
    "token-saver": {
        "id": "openleash.prompt-compression",
        "slug": "token-saver",
        "name": "Token Saver",
        "description": "Reduces repeated context so agents use fewer paid AI tokens without losing important details.",
        "category": "cost",
        "iconText": "✂️",
        "showcaseOrder": 8
    },
};
const featureAliases = {
    "openleash.blast-radius": "blast-radius",
    "openleash.code-scanner": "code-scanner",
    "openleash.dlp": "data-leakage-prevention",
    "dlp": "data-leakage-prevention",
    "openleash.sensitive-access": "sensitive-access",
    "openleash.skill-scanner": "skill-scanner",
    "openleash.mcp-scanner": "mcp-scanner",
    "openleash.rules-enforcer": "rules-enforcer",
    "openleash.prompt-compression": "token-saver",
    "prompt-compression": "token-saver"
};
export function leashFeaturePresentation(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    const slug = featureAliases[normalized] ?? normalized;
    return LEASH_FEATURE_PRESENTATIONS[slug];
}
export const LEASH_FEATURE_SHOWCASE = Object.values(LEASH_FEATURE_PRESENTATIONS)
    .sort((left, right) => left.showcaseOrder - right.showcaseOrder);
