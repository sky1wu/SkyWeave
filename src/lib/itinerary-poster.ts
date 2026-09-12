import type { ItineraryDay } from "@/domain/itinerary";

const WIDTH = 800;
const MAX_HEIGHT = 4000;
const SCALE = 1.5;
const palette = {
  ink: "#18324B",
  blue: "#0762DF",
  cyan: "#17AEC4",
  yellow: "#FFD452",
  muted: "#5D7186",
  pale: "#E5F1FF",
  line: "#DBE5F0",
  white: "#FFFFFF",
  warning: "#A13C2E",
};
type Draw = (ctx: CanvasRenderingContext2D) => void;
export interface PosterPage {
  blob: Blob;
  width: number;
  height: number;
}
export interface PosterOptions {
  title: string;
  dates: string;
  timezone: string;
  days: ItineraryDay[];
  includeNotes: boolean;
}

/** Wrap by grapheme so CJK, emoji and explicit newlines survive export. */
export function wrapPosterText(
  text: string,
  width: number,
  measure: (text: string) => number,
) {
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "grapheme" });
  return text.split(/\r?\n/).flatMap((paragraph) => {
    const lines: string[] = [];
    let line = "";
    for (const { segment } of segmenter.segment(paragraph)) {
      if (line && measure(line + segment) > width) {
        lines.push(line);
        line = segment;
      } else line += segment;
    }
    lines.push(line);
    return lines;
  });
}

/** Canvas draws only itinerary text and vector shapes; no map tiles or remote assets. */
export async function renderItineraryPoster(
  options: PosterOptions,
  signal?: AbortSignal,
): Promise<PosterPage[]> {
  await document.fonts.ready;
  signal?.throwIfAborted();
  const font = getComputedStyle(document.body).fontFamily;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器无法生成图片，请换一个浏览器重试。");
  const pages: { commands: Draw[]; height: number }[] = [];
  let commands: Draw[] = [];
  let y = 0;
  let activeDay: ItineraryDay | undefined;
  const text = (
    value: string,
    x: number,
    top: number,
    size = 20,
    color: string = palette.ink,
    weight = 400,
  ) => {
    commands.push((c) => {
      c.font = `${weight} ${size}px ${font}`;
      c.fillStyle = color;
      c.textBaseline = "top";
      c.fillText(value, x, top);
    });
  };
  const rect = (
    x: number,
    top: number,
    width: number,
    height: number,
    color: string,
  ) => {
    commands.push((c) => {
      c.fillStyle = color;
      c.fillRect(x, top, width, height);
    });
  };
  const line = (
    x: number,
    top: number,
    endX: number,
    endY: number,
    color: string,
    width = 2,
  ) => {
    commands.push((c) => {
      c.beginPath();
      c.moveTo(x, top);
      c.lineTo(endX, endY);
      c.strokeStyle = color;
      c.lineWidth = width;
      c.stroke();
    });
  };
  const circle = (x: number, top: number, radius: number, color: string) => {
    commands.push((c) => {
      c.beginPath();
      c.arc(x, top, radius, 0, Math.PI * 2);
      c.fillStyle = color;
      c.fill();
    });
  };
  const wrap = (value: string, width: number, size: number, weight: number) => {
    ctx.font = `${weight} ${size}px ${font}`;
    return wrapPosterText(value, width, (s) => ctx.measureText(s).width);
  };
  const startPage = () => {
    commands = [];
    y = 50;
    text("旅行行程", 48, y, 20, palette.blue, 650);
    line(598, 60, 744, 60, palette.blue, 4);
    circle(598, 60, 6, palette.cyan);
    circle(672, 60, 6, palette.blue);
    circle(744, 60, 8, palette.yellow);
    y += 46;
    for (const value of wrap(options.title, WIDTH - 96, 42, 750)) {
      text(value, 48, y, 42, palette.ink, 750);
      y += 58;
    }
    y += 8;
    text(options.dates, 48, y, 20, palette.muted);
    y += 34;
    text(
      `${options.days.length} 天 / ${options.days.reduce((sum, day) => sum + day.stops.length, 0)} 项安排`,
      48,
      y,
      18,
      palette.muted,
    );
    y += 52;
  };
  const finishPage = () => {
    const height = Math.max(700, y + 112);
    line(48, height - 82, WIDTH - 48, height - 82, palette.line);
    text("SkyWeave", 48, height - 56, 18, palette.blue, 700);
    text(`时间按 ${options.timezone}`, 190, height - 55, 15, palette.muted);
    const pageCommands = commands;
    const pageNumber = pages.length + 1;
    pageCommands.push((c) => {
      c.fillStyle = palette.muted;
      c.font = `400 15px ${font}`;
      c.textAlign = "right";
      c.fillText(`${pageNumber} / ${pages.length}`, WIDTH - 48, height - 55);
      c.textAlign = "left";
    });
    pages.push({ commands: pageCommands, height });
  };
  const dayHeading = (day: ItineraryDay, continued = false) => {
    const title = wrap(
      `${day.title}${continued ? "（续）" : ""}`,
      WIDTH - 234,
      25,
      700,
    );
    const height = 76 + title.length * 34;
    rect(48, y, WIDTH - 96, height, palette.pale);
    rect(48, y, 5, height, palette.blue);
    text(
      String(day.number).padStart(2, "0"),
      72,
      y + 26,
      42,
      palette.blue,
      750,
    );
    let top = y + 24;
    for (const value of title) {
      text(value, 152, top, 25, palette.ink, 700);
      top += 34;
    }
    text(day.date, 152, top + 10, 18, palette.muted);
    y += height + 26;
  };
  const ensureSpace = (height: number) => {
    if (y + height <= MAX_HEIGHT - 112) return;
    finishPage();
    startPage();
    if (activeDay) dayHeading(activeDay, true);
  };
  const paragraph = (
    value: string,
    size = 20,
    color: string = palette.muted,
    weight = 400,
    x = 130,
  ) => {
    for (const valueLine of wrap(value, WIDTH - 48 - x, size, weight)) {
      ensureSpace(size * 1.5);
      text(valueLine, x, y, size, color, weight);
      y += size * 1.5;
    }
    y += 6;
  };
  startPage();
  if (!options.days.length)
    paragraph("行程日期待定，暂无每日安排。", 22, palette.muted, 400, 48);
  for (const day of options.days) {
    activeDay = undefined;
    const headingHeight =
      102 + wrap(day.title, WIDTH - 234, 25, 700).length * 34;
    ensureSpace(headingHeight + 180);
    activeDay = day;
    dayHeading(day);
    if (!day.stops.length) paragraph("当天暂无安排，留一点时间自由探索。", 20);
    for (const [index, stop] of day.stops.entries()) {
      ensureSpace(180);
      if (stop.connection) {
        paragraph(stop.connection.summary, 17, palette.blue);
        if (stop.connection.description)
          paragraph(stop.connection.description, 17);
        y += 12;
      }
      ensureSpace(130);
      circle(82, y + 16, 18, palette.blue);
      text(
        String(index + 1).padStart(2, "0"),
        70,
        y + 5,
        19,
        palette.white,
        650,
      );
      paragraph(`${stop.time}  /  ${stop.timing}`, 19, palette.blue, 650);
      paragraph(stop.title, 28, palette.ink, 700);
      paragraph(stop.category, 17, palette.muted, 500);
      for (const detail of stop.details) {
        if (detail.kind !== "note" || options.includeNotes)
          paragraph(detail.text);
      }
      for (const warning of stop.warnings)
        paragraph(`注意：${warning}`, 18, palette.warning);
      y += 18;
      line(130, y, WIDTH - 48, y, palette.line, 1);
      y += 26;
    }
    y += 16;
  }
  finishPage();
  const output: PosterPage[] = [];
  try {
    for (const page of pages) {
      signal?.throwIfAborted();
      canvas.width = WIDTH * SCALE;
      canvas.height = Math.ceil(page.height * SCALE);
      ctx.scale(SCALE, SCALE);
      ctx.fillStyle = palette.white;
      ctx.fillRect(0, 0, WIDTH, page.height);
      for (const command of page.commands) command(ctx);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("图片生成失败，请重试或按天导出。")),
          "image/png",
        ),
      );
      output.push({ blob, width: canvas.width, height: canvas.height });
    }
    return output;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function itineraryFilename(title: string) {
  return (
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
      .trim()
      .slice(0, 80) || "旅行行程"
  );
}

/** Store PNGs in a ZIP (they are already compressed), with UTF-8 filenames. */
export async function posterArchive(
  pages: PosterPage[],
  name: string,
): Promise<Blob> {
  const chunks: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  const encoder = new TextEncoder();
  for (const [i, page] of pages.entries()) {
    const filename = encoder.encode(
      `${name}-${String(i + 1).padStart(2, "0")}.png`,
    );
    const bytes = new Uint8Array(await page.blob.arrayBuffer());
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = new Uint8Array(30 + filename.length);
    const local = new DataView(header.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, 33, true); // 1980-01-01, a valid DOS date.
    local.setUint32(14, crc, true);
    local.setUint32(18, bytes.length, true);
    local.setUint32(22, bytes.length, true);
    local.setUint16(26, filename.length, true);
    header.set(filename, 30);
    chunks.push(header, bytes);
    const entry = new Uint8Array(46 + filename.length);
    const central = new DataView(entry.buffer);
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    entry.set(header.subarray(4, 30), 6);
    central.setUint32(42, offset, true);
    entry.set(filename, 46);
    directory.push(entry);
    offset += header.length + bytes.length;
  }
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, pages.length, true);
  view.setUint16(10, pages.length, true);
  view.setUint32(
    12,
    directory.reduce((sum, entry) => sum + entry.length, 0),
    true,
  );
  view.setUint32(16, offset, true);
  return new Blob([...chunks, ...directory, end], { type: "application/zip" });
}
