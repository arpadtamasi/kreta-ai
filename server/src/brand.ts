/**
 * Product identity in one place. The GitHub project, the npm package and the
 * deployment keep their own technical names; this is the only string a
 * parent ever sees, so renaming the product is a one-line change here.
 *
 * The name deliberately avoids "KRÉTA": that mark belongs to eKRÉTA Zrt.,
 * this project is unaffiliated, and every public surface has to say so.
 */
export const BRAND = {
  name: "Üzenőfüzet",
  tagline: "Kérdezz a gyereked iskolai adatairól.",
  disclaimer:
    "Független projekt. Nem áll kapcsolatban az eKRÉTA Zrt.-vel, és nem hivatalos KRÉTA-termék.",
} as const;
