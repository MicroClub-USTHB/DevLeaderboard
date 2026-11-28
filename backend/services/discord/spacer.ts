/**
 * A fully transparent 1200×1 PNG (85 bytes). Discord sizes each card to its
 * text, so cards come out with different widths; giving every card this image
 * stretches them all to Discord's maximum card width. It is invisible and only
 * one pixel tall.
 */
export const SPACER_NAME = "spacer.png";

export const SPACER_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAABLAAAAABCAYAAADO+FcMAAAAHElEQVR42u3BMQEAAADCoPVPbQ0PoAAAAADg2AASwQABPK+CjgAAAABJRU5ErkJggg==",
    "base64",
);
