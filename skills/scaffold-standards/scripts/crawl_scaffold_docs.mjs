#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {
    maxPages: 20,
    sameOrigin: true,
    waitMs: 800,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--url") args.url = argv[++i];
    else if (value === "--out") args.out = argv[++i];
    else if (value === "--max-pages") args.maxPages = Number(argv[++i]);
    else if (value === "--include-external") args.sameOrigin = false;
    else if (value === "--wait-ms") args.waitMs = Number(argv[++i]);
    else if (value === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function usage() {
  const script = path.basename(fileURLToPath(import.meta.url));
  return [
    `Usage: node ${script} --url <docs-url> --out <output-dir> [--max-pages 20]`,
    "",
    "Crawls scaffold documentation with Playwright and writes markdown-ish page captures, links, and summary.json.",
  ].join("\n");
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function slugifyUrl(url) {
  const parsed = new URL(url);
  const raw = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "") || parsed.hostname;
  return raw.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || "index";
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.url || !args.out) {
    console.log(usage());
    process.exit(args.help ? 0 : 1);
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    console.error("Playwright is not installed in this Node environment.");
    console.error("Install it in the working project, for example: npm install -D playwright");
    throw error;
  }

  const startUrl = new URL(args.url).toString();
  const startOrigin = new URL(startUrl).origin;
  const outDir = path.resolve(args.out);
  const pagesDir = path.join(outDir, "pages");
  await mkdir(pagesDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const queue = [startUrl];
  const seen = new Set();
  const captures = [];
  const discoveredLinks = new Set();

  while (queue.length > 0 && captures.length < args.maxPages) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    console.error(`Crawling ${current}`);
    await page.goto(current, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(args.waitMs);

    const data = await page.evaluate(() => {
      const main = document.querySelector("main") || document.body;
      const title = document.title || document.querySelector("h1")?.textContent || location.href;
      const headings = Array.from(main.querySelectorAll("h1,h2,h3")).map((el) => ({
        level: el.tagName.toLowerCase(),
        text: el.textContent || "",
      }));
      const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: a.href,
        text: a.textContent || "",
      }));
      const text = main.innerText || document.body.innerText || "";
      return { title, headings, links, text };
    });

    const cleanTitle = normalizeWhitespace(data.title);
    const cleanText = data.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n");

    const headings = data.headings
      .map((heading) => `${"#".repeat(Number(heading.level.slice(1)))} ${normalizeWhitespace(heading.text)}`)
      .filter((line) => !/^#+\s*$/.test(line));

    const pageSlug = slugifyUrl(current);
    const fileName = `${captures.length + 1}-${pageSlug}.md`;
    const markdown = [
      `# ${cleanTitle}`,
      "",
      `Source: ${current}`,
      "",
      "## Headings",
      "",
      headings.length ? headings.join("\n") : "(none captured)",
      "",
      "## Text",
      "",
      cleanText,
      "",
    ].join("\n");

    await writeFile(path.join(pagesDir, fileName), markdown, "utf8");
    captures.push({ url: current, title: cleanTitle, file: `pages/${fileName}`, headings: data.headings });

    for (const link of data.links) {
      try {
        const href = new URL(link.href).toString().replace(/#.*$/, "");
        if (!href.startsWith("http")) continue;
        discoveredLinks.add(`${href}\t${normalizeWhitespace(link.text)}`);
        if (args.sameOrigin && new URL(href).origin !== startOrigin) continue;
        if (!seen.has(href) && !queue.includes(href) && captures.length + queue.length < args.maxPages * 3) {
          queue.push(href);
        }
      } catch {
        // Ignore invalid browser-expanded URLs.
      }
    }
  }

  await browser.close();

  const summary = {
    startUrl,
    capturedAt: new Date().toISOString(),
    maxPages: args.maxPages,
    pages: captures,
  };

  await writeFile(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outDir, "links.txt"), Array.from(discoveredLinks).sort().join("\n"), "utf8");
  console.log(`Captured ${captures.length} pages into ${outDir}`);
}

main().catch((error) => {
  console.error(error?.stack || String(error));
  process.exit(1);
});
