import { FlagEmbedding, EmbeddingModel } from "fastembed";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * Local embeddings. The whole point of Engram is that your data stays on your
 * machine, so embeddings run locally (bge-small-en-v1.5, 384-dim) — nothing is
 * sent to a vendor. The interface is intentionally small so an alternative
 * backend could be swapped in later.
 *
 * If the model can't initialise (e.g. the weights can't be downloaded), the
 * embedder is unavailable and recall transparently falls back to keyword-only.
 */
export interface Embedder {
  readonly model: string;
  embedQuery(text: string): Promise<Float32Array>;
  embedPassage(text: string): Promise<Float32Array>;
}

export const EMBEDDING_MODEL = "fast-bge-small-en-v1.5";

function log(message: string): void {
  process.stderr.write(`[engram] ${message}\n`);
}

let initPromise: Promise<Embedder | null> | null = null;

async function create(): Promise<Embedder | null> {
  try {
    const cacheDir = process.env.ENGRAM_MODEL_DIR ?? join(homedir(), ".engram", "models");
    mkdirSync(cacheDir, { recursive: true });
    const fe = await FlagEmbedding.init({
      model: EmbeddingModel.BGESmallENV15,
      cacheDir,
      showDownloadProgress: false,
    });
    log(`embedder ready (${EMBEDDING_MODEL})`);
    return {
      model: EMBEDDING_MODEL,
      async embedQuery(text: string): Promise<Float32Array> {
        return Float32Array.from(await fe.queryEmbed(text));
      },
      async embedPassage(text: string): Promise<Float32Array> {
        for await (const batch of fe.passageEmbed([text])) {
          if (batch[0]) return Float32Array.from(batch[0]);
        }
        throw new Error("embedder produced no vector");
      },
    };
  } catch (err) {
    log(
      `embedder unavailable — falling back to keyword-only recall: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

/** Lazily initialise the embedder once; cache the result (including failure). */
export function getEmbedder(): Promise<Embedder | null> {
  if (!initPromise) initPromise = create();
  return initPromise;
}
