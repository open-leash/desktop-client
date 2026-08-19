import { NextResponse } from "next/server";

type GoogleFontFamily = {
  family?: string;
  category?: string;
  fonts?: Record<string, unknown>;
};

type GoogleFontsMetadata = {
  familyMetadataList?: GoogleFontFamily[];
};

export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }

  try {
    const response = await fetch("https://fonts.google.com/metadata/fonts", { cache: "no-store" });
    if (!response.ok) throw new Error(`Google Fonts metadata returned ${response.status}`);

    const metadata = (await response.json()) as GoogleFontsMetadata;
    const families = (metadata.familyMetadataList ?? [])
      .filter((font): font is GoogleFontFamily & { family: string } => Boolean(font.family))
      .map((font) => ({
        family: font.family,
        category: font.category ?? "",
        weights: Object.keys(font.fonts ?? {})
          .filter((weight) => /^\d+$/.test(weight))
          .sort((left, right) => Number(left) - Number(right))
      }))
      .sort((left, right) => left.family.localeCompare(right.family));

    return NextResponse.json(
      { families },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ families: [] }, { status: 502 });
  }
}
