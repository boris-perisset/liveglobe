/**
 * Minimaler ZIP-Leser für die GDELT-Rohdateien.
 *
 * Bewusst ohne Bibliothek: Die Dateien enthalten genau einen Deflate-Eintrag,
 * und `DecompressionStream("deflate-raw")` gehört zum Web-Standard. Damit bleibt
 * die Edge Function abhängigkeitsfrei — und der Speicherbedarf niedrig, weil
 * nie die ganze entpackte Datei im Arbeitsspeicher liegt.
 */

const SIG_EOCD = 0x06054b50; // PK\x05\x06  Ende des zentralen Verzeichnisses
const SIG_CD = 0x02014b50; // PK\x01\x02  Eintrag im zentralen Verzeichnis
const SIG_LOCAL = 0x04034b50; // PK\x03\x04  lokaler Dateikopf

export interface ZipEntry {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  dataOffset: number;
}

/** Liest das zentrale Verzeichnis und liefert den ersten Eintrag. */
export function readFirstEntry(buf: ArrayBuffer): ZipEntry {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // EOCD von hinten suchen (Kommentar darf bis 65535 Byte lang sein)
  let eocd = -1;
  const min = Math.max(0, bytes.length - 65_557);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: kein zentrales Verzeichnis gefunden");

  const entries = view.getUint16(eocd + 10, true);
  if (entries === 0) throw new Error("ZIP: Archiv ist leer");

  const cdOffset = view.getUint32(eocd + 16, true);
  if (view.getUint32(cdOffset, true) !== SIG_CD) {
    throw new Error("ZIP: zentrales Verzeichnis unlesbar");
  }

  const compressionMethod = view.getUint16(cdOffset + 10, true);
  const compressedSize = view.getUint32(cdOffset + 20, true);
  const uncompressedSize = view.getUint32(cdOffset + 24, true);
  const nameLen = view.getUint16(cdOffset + 28, true);
  const extraLen = view.getUint16(cdOffset + 30, true);
  const localOffset = view.getUint32(cdOffset + 42, true);

  const name = new TextDecoder().decode(
    bytes.subarray(cdOffset + 46, cdOffset + 46 + nameLen),
  );

  if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
    throw new Error("ZIP: lokaler Dateikopf unlesbar");
  }
  // Die Längenangaben im lokalen Kopf können von denen im Verzeichnis abweichen.
  const localNameLen = view.getUint16(localOffset + 26, true);
  const localExtraLen = view.getUint16(localOffset + 28, true);
  const dataOffset = localOffset + 30 + localNameLen + localExtraLen;

  return { name, compressionMethod, compressedSize, uncompressedSize, dataOffset };
}

/**
 * Entpackt den ersten Eintrag und liefert ihn zeilenweise.
 * Der Inhalt wird gestreamt, nicht am Stück in den Speicher gelegt.
 */
export async function* unzipLines(buf: ArrayBuffer): AsyncGenerator<string> {
  const entry = readFirstEntry(buf);
  const raw = new Uint8Array(buf, entry.dataOffset, entry.compressedSize);

  let stream: ReadableStream = new Blob([raw]).stream();
  if (entry.compressionMethod === 8) {
    stream = stream.pipeThrough(
      new DecompressionStream("deflate-raw") as unknown as ReadableWritablePair,
    );
  } else if (entry.compressionMethod !== 0) {
    throw new Error(`ZIP: Verfahren ${entry.compressionMethod} wird nicht unterstützt`);
  }

  const reader = (stream as ReadableStream<Uint8Array>)
    .pipeThrough(new TextDecoderStream("utf-8", { fatal: false }))
    .getReader();

  let rest = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += value;
    let nl: number;
    while ((nl = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, nl).replace(/\r$/, "");
      rest = rest.slice(nl + 1);
      if (line) yield line;
    }
  }
  const last = rest.replace(/\r$/, "");
  if (last) yield last;
}
