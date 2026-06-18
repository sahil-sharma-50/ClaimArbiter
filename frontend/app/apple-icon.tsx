import { ImageResponse } from "next/og";

import {
  BRANDMARK_FAVICON_GOLD,
  BRANDMARK_PATHS,
  BRANDMARK_STROKE_WIDTH,
  BRANDMARK_VIEWBOX,
} from "@/landing-page/lib/brandmark-paths";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
        }}
      >
        <svg
          width="148"
          height="148"
          viewBox={BRANDMARK_VIEWBOX}
          fill="none"
          stroke={BRANDMARK_FAVICON_GOLD}
          strokeWidth={BRANDMARK_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          xmlns="http://www.w3.org/2000/svg"
        >
          {BRANDMARK_PATHS.map((d) => (
            <path key={d.slice(0, 28)} d={d} />
          ))}
        </svg>
      </div>
    ),
    { ...size },
  );
}
